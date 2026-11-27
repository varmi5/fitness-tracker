#!/usr/bin/env python3
"""Build/check the website plugin from canonical manifests, skill and site artwork.

Uses Python's standard library. --check is read-only and validates uncompressed
ZIP contents so different zlib versions do not cause false CI failures.
"""
import argparse
import io
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PACKAGE = REPO / 'plugins/mcp-logger'
ARCHIVE = REPO / 'public/fitnesstrackr-plugin.zip'


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def no_credentials(value):
    if isinstance(value, dict):
        for key, child in value.items():
            require(key.lower() not in {'clientsecret', 'client_secret', 'password', 'access_token', 'refresh_token'},
                    'Credential field found in package metadata.')
            if key == 'headers':
                require(not child, 'Public packages must not contain server headers.')
            no_credentials(child)
    elif isinstance(value, list):
        for child in value:
            no_credentials(child)


def expected_files():
    manifest = json.loads((PACKAGE / 'plugin.json').read_text())
    mcp = json.loads((PACKAGE / 'mcp.json').read_text())
    skill = (PACKAGE / 'skills/fitness-nutrition-mcp/SKILL.md').read_bytes()
    artwork = (REPO / 'public/icon-512.png').read_bytes()
    require(manifest.get('$schema') == 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'Invalid portable manifest schema.')
    require(manifest.get('name') == 'mcp-logger', 'Preserve the existing plugin identity.')
    require(re.fullmatch(r'\d+\.\d+\.\d+', manifest.get('version', '')), 'Package version must be SemVer.')
    interface = manifest['extensions']['com.openai']['interface']
    require(interface.get('displayName') == 'FitnessTrackr', 'Unexpected display name.')
    require(0 < len(interface.get('shortDescription', '')) <= 30, 'Subtitle must have 1–30 characters.')
    require(interface.get('category') == 'Healthcare', 'Unexpected category.')
    require(interface.get('logo') == interface.get('composerIcon') == './assets/icon.png', 'Both host icons must use the current site artwork.')
    for key in ('websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'):
        require(interface.get(key, '').startswith('https://'), 'Missing or unexpected listing URL: ' + key)
    require(artwork[:8] == b'\x89PNG\r\n\x1a\n', 'Site icon must be a PNG.')
    width, height = struct.unpack('>II', artwork[16:24])
    require(width == height and 256 <= width <= 4096 and len(artwork) <= 5 * 1024 * 1024, 'Site icon does not meet package dimensions/size requirements.')
    require(mcp.get('$schema') == 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'Invalid MCP schema.')
    require(set(mcp['mcpServers']) == {'mcp-logger'}, 'Unexpected MCP inventory.')
    server = mcp['mcpServers']['mcp-logger']
    require(server['type'] == 'streamable-http' and server['url'].startswith('https://') and server['url'].endswith('/mcp'), 'Preserve the existing hosted endpoint/transport.')
    auth = server['extensions']['com.openai']['auth']
    require(auth['type'] == 'oauth' and auth['client'] == {'mode': 'dcr'}, 'Preserve automatic OAuth registration.')
    require(auth['baseScopes'] == ['fitness:read', 'fitness:write', 'offline_access'], 'Meal logging must retain the existing renewable base scopes.')
    require(auth['defaultScopes'] == ['fitness:read', 'fitness:write', 'fitness:settings:write', 'offline_access'], 'Unexpected default OAuth scopes.')
    no_credentials(manifest)
    no_credentials(mcp)
    require(not manifest.get('apps') and not manifest['extensions']['com.openai'].get('apps'), 'Public uploads cannot include private app bindings.')
    text = skill.decode('utf-8')
    require(text.startswith('---\nname: fitness-nutrition-mcp\ndescription:'), 'Skill frontmatter is missing.')
    tools = set(re.findall(r'\bregister\(\s*"([^"]+)"', (REPO / 'lib/mcp-tools.ts').read_text()))
    mentioned = set(re.findall(r'`((?:get_|set_|search_|preview_)[a-z_]+|log_meal|update_meal|delete_meal)`', text))
    require(mentioned <= tools, 'Skill mentions tools not exposed by this server: ' + ', '.join(sorted(mentioned - tools)))
    compat = {key: manifest[key] for key in ('name', 'version', 'description', 'author')}
    compat.update(interface=interface, skills='./skills', mcpServers='./.mcp.json')
    compat_mcp = {'mcpServers': mcp['mcpServers']}
    files = {
        'plugin.json': encode_json(manifest),
        'mcp.json': encode_json(mcp),
        '.codex-plugin/plugin.json': encode_json(compat),
        '.mcp.json': encode_json(compat_mcp),
        'skills/fitness-nutrition-mcp/SKILL.md': skill,
        'assets/icon.png': artwork,
    }
    generated = {PACKAGE / name: data for name, data in files.items() if name not in ('plugin.json', 'mcp.json', 'skills/fitness-nutrition-mcp/SKILL.md')}
    generated[PACKAGE / 'assets/icon.svg'] = (REPO / 'public/icon.svg').read_bytes()
    generated[REPO / 'skills/fitness-nutrition-mcp/SKILL.md'] = skill
    return manifest['version'], files, generated


def check_archive(files):
    with zipfile.ZipFile(ARCHIVE) as archive:
        require(set(archive.namelist()) == set(files), 'ZIP inventory differs from the intended package.')
        require(archive.testzip() is None, 'ZIP CRC validation failed.')
        for name, expected in files.items():
            require(archive.read(name) == expected, 'Stale ZIP entry: ' + name)
            require(not archive.getinfo(name).is_dir(), 'Unexpected directory entry.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate source mirrors and ZIP without writing.')
    args = parser.parse_args()
    version, files, generated = expected_files()
    if args.check:
        for path, expected in generated.items():
            require(path.exists() and path.read_bytes() == expected, 'Stale generated package file: ' + str(path.relative_to(REPO)))
    else:
        for path, data in generated.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists() or path.read_bytes() != data:
                path.write_bytes(data)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        ARCHIVE.write_bytes(output.getvalue())
    check_archive(files)
    print('FitnessTrackr plugin ' + version + ' verified: ' + str(len(files)) + ' files; current site icon, matching manifests/scopes and valid ZIP.')
    print('This checks package integrity, not OpenAI submission approval or reviewer/demo completion.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        print('Plugin package check failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
