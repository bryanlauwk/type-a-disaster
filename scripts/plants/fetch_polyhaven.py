import json,sys,urllib.request,os
def get(u):
  return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'Mozilla/5.0 primordia-asset-fetch'}))
id=sys.argv[1]; res=sys.argv[2] if len(sys.argv)>2 else '1k'
d=json.load(get(f'https://api.polyhaven.com/files/{id}'))
g=d['gltf'].get(res) or d['gltf'].get('1k'); g=g['gltf']
os.makedirs(id,exist_ok=True)
open(f'{id}/{id}.gltf','wb').write(get(g['url']).read())
tot=g['size']
for rel,info in g.get('include',{}).items():
  p=os.path.join(id,rel); os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'wb').write(get(info['url']).read()); tot+=info['size']
print(id, round(tot/1e6,1),'MB')
