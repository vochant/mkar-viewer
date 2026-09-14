use crate::error::{MkarError, MkarErrorCode};

pub const IMPLEMENTATION: u16 = 0x2009;
pub const STANDARD_VERSION: u16 = 2;
pub const FILE_OVERHEAD: usize = 225;

pub const ENCRYPTED: u8 = 64;
pub const COMPRESSED: u8 = 32;
pub const ROOTDIR: u8 = 16;
pub const SYMLINK: u8 = 8;
pub const PATH_PROP: u8 = 4;
pub const SCRIPT: u8 = 2;
pub const NETWORK: u8 = 1;

pub struct BitWriter {
    output: Vec<u8>,
    data: u8,
    buffer_len: u8,
}

impl BitWriter {
    pub fn new() -> Self {
        Self {
            output: Vec::new(),
            data: 0,
            buffer_len: 0,
        }
    }

    pub fn write_bits(&mut self, mut value: u16, mut len: u8) -> Result<(), MkarError> {
        if len > 16 || (len < 16 && value >= (1u16 << len)) {
            return Err(MkarError::new(
                MkarErrorCode::InvalidEntry,
                "Bit value does not fit requested width",
            ));
        }

        while u16::from(len) + u16::from(self.buffer_len) >= 8 {
            let free_len = 8 - self.buffer_len;
            let mask = ((1u16 << free_len) - 1) << (len - free_len);
            self.data |= ((value & mask) >> (len - free_len)) as u8;
            self.output.push(self.data);
            self.data = 0;
            self.buffer_len = 0;
            len -= free_len;
            value &= (1u16 << len).wrapping_sub(1);
        }

        if len > 0 {
            let free_len = 8 - self.buffer_len;
            let mask = (1u16 << len) - 1;
            self.data |= ((value & mask) << (free_len - len)) as u8;
            self.buffer_len += len;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Vec<u8> {
        if self.buffer_len > 0 {
            self.output.push(self.data);
        }
        self.output
    }
}

pub struct BitReader<'a> {
    input: &'a [u8],
    position: usize,
    data: u8,
    buffer_len: u8,
}

impl<'a> BitReader<'a> {
    pub fn new(input: &'a [u8]) -> Self {
        Self {
            input,
            position: 0,
            data: 0,
            buffer_len: 0,
        }
    }

    fn next_byte(&mut self) -> Result<(), MkarError> {
        self.data = *self.input.get(self.position).ok_or_else(|| {
            MkarError::new(
                MkarErrorCode::InvalidArchive,
                "Unexpected end of bit stream",
            )
        })?;
        self.position += 1;
        self.buffer_len = 8;
        Ok(())
    }

    pub fn read_bits(&mut self, mut len: u8) -> Result<u16, MkarError> {
        if len > 16 {
            return Err(MkarError::new(
                MkarErrorCode::InvalidArchive,
                "Requested bit width exceeds 16",
            ));
        }
        let mut result = 0u16;
        if len > 0 && self.buffer_len == 0 {
            self.next_byte()?;
        }

        while len > 0 && self.buffer_len <= len {
            let mask = (1u16 << self.buffer_len) - 1;
            result <<= self.buffer_len;
            result |= u16::from(self.data) & mask;
            len -= self.buffer_len;
            if len > 0 {
                self.next_byte()?;
            } else {
                self.buffer_len = 0;
            }
        }

        if len > 0 {
            let mask = ((1u16 << len) - 1) << (self.buffer_len - len);
            result <<= len;
            result |= (u16::from(self.data) & mask) >> (self.buffer_len - len);
            self.buffer_len -= len;
        }
        Ok(result)
    }

    pub fn bytes_consumed(&self) -> usize {
        self.position
    }
}

#[derive(Clone)]
pub struct Mask {
    mapping: [u8; 256],
    rmapping: [u8; 256],
    version: u16,
}

impl Mask {
    pub fn from_mapping(mapping: [u8; 256], version: u16) -> Result<Self, MkarError> {
        let mut seen = [false; 256];
        let mut rmapping = [0u8; 256];
        for (index, value) in mapping.iter().copied().enumerate() {
            if seen[value as usize] {
                return Err(MkarError::new(
                    MkarErrorCode::InvalidArchive,
                    "Mask mapping is not a permutation",
                ));
            }
            seen[value as usize] = true;
            rmapping[value as usize] = index as u8;
        }
        Ok(Self {
            mapping,
            rmapping,
            version,
        })
    }

    pub fn write(writer: &mut BitWriter, seed: u64) -> Result<Self, MkarError> {
        let mut remaining: Vec<u8> = (0u8..=255).collect();
        let mut mapping = [0u8; 256];
        let mut limit = 128u8;
        let mut len = 8u8;
        let mut ci = 0u8;
        let mut rng = Xoshiro256pp::new(seed);

        for i in 0u8..255 {
            let ord = (rng.next() % remaining.len() as u64) as usize;
            mapping[i as usize] = remaining.remove(ord);
            if ci == limit {
                len -= 1;
                ci = 0;
                limit >>= 1;
            }
            writer.write_bits(ord as u16, len)?;
            ci = ci.wrapping_add(1);
        }
        mapping[255] = remaining[0];
        Self::from_mapping(mapping, 2)
    }

    pub fn read(reader: &mut BitReader<'_>, version: u16) -> Result<Self, MkarError> {
        let mut remaining: Vec<u8> = (0u8..=255).collect();
        let mut mapping = [0u8; 256];
        let mut limit = 128u8;
        let mut len = 8u8;
        let mut ci = 0u8;

        for i in 0u8..255 {
            if ci == limit {
                len -= 1;
                ci = 0;
                limit >>= 1;
            }
            let ord = reader.read_bits(len)? as usize;
            if ord >= remaining.len() {
                return Err(MkarError::new(
                    MkarErrorCode::InvalidArchive,
                    "Invalid mask table ordinal",
                ));
            }
            mapping[i as usize] = remaining.remove(ord);
            ci = ci.wrapping_add(1);
        }
        mapping[255] = remaining[0];
        Self::from_mapping(mapping, version)
    }

    pub fn mask_bytes(&self, buf: &mut [u8]) {
        if self.version < 2 {
            for i in 1..buf.len() {
                buf[i] = buf[i].wrapping_add(buf[i - 1]);
            }
            for byte in buf.iter_mut() {
                *byte = self.mapping[*byte as usize];
            }
        }

        if self.version == 1 {
            let mut e = 1u8;
            for byte in buf.iter_mut() {
                *byte = byte.wrapping_add(e);
                e = e.wrapping_mul(101);
            }
        } else if self.version == 2 {
            let mut stream = Xoshiro256ppByteStream::new(self.seed());
            for byte in buf.iter_mut() {
                *byte = byte.wrapping_add(stream.next_byte());
            }
        }

        if self.version >= 2 {
            let mut acc = 10u8;
            for byte in buf.iter_mut() {
                *byte = self.mapping[byte.wrapping_add(acc) as usize];
                acc ^= *byte;
            }
            for byte in buf.iter_mut() {
                *byte = self.mapping[*byte as usize];
            }
        }

        for i in 1..buf.len() {
            buf[i] ^= buf[i - 1];
        }
        for i in (1..buf.len()).rev() {
            let lb = (i + 1) & (i + 1).wrapping_neg();
            if lb != i + 1 {
                buf[i] ^= buf[i - lb];
            }
        }
    }

    pub fn unmask_bytes(&self, buf: &mut [u8]) {
        for i in 1..buf.len() {
            let lb = (i + 1) & (i + 1).wrapping_neg();
            if lb != i + 1 {
                buf[i] ^= buf[i - lb];
            }
        }
        for i in (1..buf.len()).rev() {
            buf[i] ^= buf[i - 1];
        }

        if self.version >= 2 {
            for byte in buf.iter_mut() {
                *byte = self.rmapping[*byte as usize];
            }
            let mut acc = 10u8;
            for byte in buf.iter_mut() {
                let y = *byte;
                *byte = self.rmapping[*byte as usize].wrapping_sub(acc);
                acc ^= y;
            }
        }

        if self.version == 1 {
            let mut e = 1u8;
            for byte in buf.iter_mut() {
                *byte = byte.wrapping_sub(e);
                e = e.wrapping_mul(101);
            }
        } else if self.version == 2 {
            let mut stream = Xoshiro256ppByteStream::new(self.seed());
            for byte in buf.iter_mut() {
                *byte = byte.wrapping_sub(stream.next_byte());
            }
        }

        if self.version < 2 {
            for byte in buf.iter_mut() {
                *byte = self.rmapping[*byte as usize];
            }
            for i in (1..buf.len()).rev() {
                buf[i] = buf[i].wrapping_sub(buf[i - 1]);
            }
        }
    }

    fn seed(&self) -> u64 {
        let mut seed = 0u64;
        for i in 0..=7 {
            seed |= u64::from(self.mapping[i << 2]) << (i << 3);
        }
        seed
    }
}

struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D049BB133111EB);
        value ^ (value >> 31)
    }
}

struct Xoshiro256pp {
    state: [u64; 4],
}

impl Xoshiro256pp {
    fn new(seed: u64) -> Self {
        let mut split_mix = SplitMix64::new(seed);
        Self {
            state: std::array::from_fn(|_| split_mix.next()),
        }
    }

    fn next(&mut self) -> u64 {
        let result = self.state[0]
            .wrapping_add(self.state[3])
            .rotate_left(23)
            .wrapping_add(self.state[0]);
        let shift = self.state[1] << 17;
        self.state[2] ^= self.state[0];
        self.state[3] ^= self.state[1];
        self.state[1] ^= self.state[2];
        self.state[0] ^= self.state[3];
        self.state[2] ^= shift;
        self.state[3] = self.state[3].rotate_left(45);
        result
    }
}

struct Xoshiro256ppByteStream {
    rng: Xoshiro256pp,
    buffer: [u8; 8],
    index: usize,
}

impl Xoshiro256ppByteStream {
    fn new(seed: u64) -> Self {
        Self {
            rng: Xoshiro256pp::new(seed),
            buffer: [0; 8],
            index: 8,
        }
    }

    fn next_byte(&mut self) -> u8 {
        if self.index == 8 {
            let value = self.rng.next();
            self.buffer = value.to_be_bytes();
            self.index = 0;
        }
        let value = self.buffer[self.index];
        self.index += 1;
        value
    }
}

#[cfg(test)]
mod tests {
    use super::{BitReader, Mask};

    #[test]
    fn bit_reader_reads_across_byte_boundary() {
        let mut reader = BitReader::new(&[0b1011_0010, 0b0110_0000]);

        assert_eq!(reader.read_bits(3).unwrap(), 0b101);
        assert_eq!(reader.read_bits(7).unwrap(), 0b1001001);
    }

    #[test]
    fn mask_round_trip_restores_literal_bytes() {
        let mapping: [u8; 256] = std::array::from_fn(|index| index as u8);
        let mask = Mask::from_mapping(mapping, 2).unwrap();
        let original = vec![0, 1, 2, 3, 127, 128, 254, 255];
        let mut value = original.clone();

        for _ in 0..3 {
            mask.mask_bytes(&mut value);
        }
        for _ in 0..3 {
            mask.unmask_bytes(&mut value);
        }

        assert_eq!(value, original);
    }
}
