import hashlib
import json
import shutil
import tarfile
import urllib.request
from pathlib import Path

root = Path('/opt/sources')
lock = json.loads((Path('/opt/wasm/libarchive') / 'sources.json').read_text())
for name, source in lock['packages'].items():
    if name == 'bzip2':
        archive = root / 'bzip2-1.0.8.tar.gz'
        with urllib.request.urlopen(source['url']) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != source['sha256']:
            raise SystemExit('bzip2 checksum mismatch')
        continue
    archive = root / f'{name}.package'
    with urllib.request.urlopen(source['url']) as response, archive.open('wb') as output:
        shutil.copyfileobj(response, output)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != source['sha256']:
        raise SystemExit(f'{name} checksum mismatch: {actual}')
    with tarfile.open(archive, 'r:*') as package:
        members = package.getmembers()
        top = members[0].name.split('/', 1)[0]
        package.extractall(root)
    extracted = root / top
    extracted.rename(root / name)
    archive.unlink()
