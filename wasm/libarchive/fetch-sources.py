import json
import subprocess

lock = json.load(open('/opt/wasm/libarchive/sources.json'))
for name, source in lock['repositories'].items():
    subprocess.run(['git', 'clone', '--revision', source['revision'], '--depth', '1', source['url'], '/opt/sources/' + name], check=True)
subprocess.run(['git', '-C', '/opt/sources/mbedtls', 'submodule', 'update', '--init', '--depth', '1'], check=True)
subprocess.run(['curl', '--fail', '--location', '--retry', '2', lock['bzip2']['url'], '--output', '/opt/sources/bzip2-1.0.8.tar.gz'], check=True)
actual = subprocess.check_output(['sha256sum', '/opt/sources/bzip2-1.0.8.tar.gz'], text=True).split()[0]
if actual != lock['bzip2']['sha256']:
    raise SystemExit('bzip2 checksum mismatch')
