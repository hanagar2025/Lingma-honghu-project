"""把 AI 主线全链的环节与核心股名单导出给小程序后端（名单只有一处：scripts/ai-mainline-map.py 的 LAYERS）

用法：python3 scripts/chain-universe.py            重新生成 backend/src/services/chain/data/universe.json
      python3 scripts/chain-universe.py --check    只比对，不一致时退出码 1（CI 用）

只读 ai-mainline-map.py 里的 LAYERS，不运行它的取数，不联网。
"""
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'backend', 'src', 'services', 'chain', 'data', 'universe.json')


def load_layers():
    argv, sys.argv = sys.argv, ['ai-mainline-map.py']
    try:
        spec = importlib.util.spec_from_file_location('ai_mainline_map', os.path.join(HERE, 'ai-mainline-map.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        sys.argv = argv
    return mod.LAYERS


def build():
    return {
        'source': 'scripts/ai-mainline-map.py',
        'layers': [{'layer': layer, 'segments': [{'segment': seg, 'codes': codes} for seg, codes in segs.items()]}
                   for layer, segs in load_layers()],
    }


if __name__ == '__main__':
    text = json.dumps(build(), ensure_ascii=False, indent=1) + '\n'
    if '--check' in sys.argv:
        current = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        if current != text:
            sys.exit('universe.json 与 ai-mainline-map.py 的名单不一致。运行 python3 scripts/chain-universe.py 重新生成')
        print('名单一致')
    else:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        open(OUT, 'w', encoding='utf-8').write(text)
        print('已生成', os.path.relpath(OUT))
