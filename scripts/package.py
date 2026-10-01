from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / 'dist' / 'fastwebmcp-wordpress.zip'
output.parent.mkdir(exist_ok=True)
entries = [*root.glob('*.php'), *root.glob('*.ts'), *root.glob('LICENSE*'),
           root / 'readme.txt', root / 'README.md', root / 'FRONTEND.md']
for folder in ('assets', 'blocks', 'vendor'):
    entries.extend(p for p in (root / folder).rglob('*') if p.is_file())
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(set(entries)):
        archive.write(file, 'fastwebmcp-wordpress/' + file.relative_to(root).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'fastwebmcp-wordpress/fastwebmcp-wordpress.php' in archive.namelist()
print(f'ZIP verified: {output}')
