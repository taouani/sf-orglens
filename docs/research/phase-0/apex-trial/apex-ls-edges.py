"""Compares the method edges of apex-ls with the calls a run of the trial records.

    python3 apex-ls-edges.py <summaries of apex-ls> <result of run-corpus.ts as JSON> [<how many examples>]

The first file holds the type summaries that apex-ls 6.4.0 writes for a workspace, one JSON document per type,
each behind a line that starts with "### ". How they were produced is in the report of the Apex trial. An edge
is compared by class, kind of member, member, target class, target method and number of arguments. A
constructor, an initialiser and the body of a trigger are compared as one kind without a name, so several calls
of the trial can fall on one edge.
"""
import json,re,sys,collections
def tname(t):
    outer=[o['name']['value'] for o in t.get('outer',[])]
    return '.'.join(outer+[t['name']['value']]).lower()
def load(path):
    txt=open(path).read(); parts=re.split(r'^### (.*)$',txt,flags=re.M)
    edges=set(); types=set(); kinds=collections.Counter()
    def walk(js,prefix):
        name=(prefix+'.' if prefix else '')+js['name'].lower(); types.add(name)
        members=[('method',m) for m in js.get('methods',[])]+[('ctor',m) for m in js.get('constructors',[])]+[('field',m) for m in js.get('fields',[])]+[('block',m) for m in js.get('blocks',[])]
        for kind,m in members:
            for d in m.get('dependents',[]):
                kinds[d['$type']]+=1
                if d['$type']=='Method':
                    edges.add((name,kind,(m.get('name') or '').lower(),tname(d['typeId']['typeName']),d['name'].lower(),len(d.get('parameterTypes',[]))))
        for n in js.get('nestedTypes',[]): walk(n,name)
    for i in range(1,len(parts),2):
        try: js=json.loads(parts[i+1])
        except Exception: continue
        walk(js,'')
    return edges,types,kinds
ls,types,kinds=load(sys.argv[1])
print('apex-ls dependents by kind',dict(kinds),'types',len(types))
mine=set()
res=json.load(open(sys.argv[2]))
for c in res['calls']:
    m=re.match(r'Apex(Class|Trigger):([^#]+)(?:#(.*))?$',c['from'])
    cls=m.group(2); sub=m.group(3) or ''
    segs=sub.split('/') if sub else []
    path=[cls]; kind='block'; member=''
    for s in segs:
        k,_,v=s.partition(':')
        if k=='inner': path.append(v)
        elif k=='method': kind='method'; member=v.split('(')[0]
        elif k=='ctor': kind='ctor'; member=''
        elif k in('var','prop'): kind='field'; member=v
        elif k=='init': kind='block'
    to,_,n=c['to'].rpartition('/'); ttype,_,tm=to.rpartition('.')
    mine.add(('.'.join(path),kind,member,ttype,tm,int(n)))
norm=lambda e:(e[0],e[1] if e[1] in('method','field') else 'other',e[2] if e[1] in('method','field') else '',e[3],e[4],e[5])
L=set(map(norm,ls)); M=set(map(norm,mine))
Lp=set(e for e in L if e[3] in types)   # targets that are types of the project
print('apex-ls method edges',len(L),'to types of the project',len(Lp),'| trial edges',len(M))
print('apex-ls edges the trial has',len(Lp&M),'of',len(Lp),f'({100*len(Lp&M)/max(1,len(Lp)):.1f}%)')
print('trial edges apex-ls has',len(M&Lp),'of',len(M),f'({100*len(M&Lp)/max(1,len(M)):.1f}%)')
import random; random.seed(5)
miss=sorted(Lp-M); extra=sorted(M-Lp)
for e in random.sample(miss,min(int(sys.argv[3]) if len(sys.argv)>3 else 12,len(miss))): print('  only apex-ls:',e)
for e in random.sample(extra,min(int(sys.argv[3]) if len(sys.argv)>3 else 12,len(extra))): print('  only trial:  ',e)
print('only apex-ls by method name',collections.Counter(e[4] for e in miss).most_common(6))
print('only trial: constructors',sum(1 for e in extra if e[4]=='<init>'),'from a trigger or initialiser',sum(1 for e in extra if e[4]!='<init>' and e[1]=='other'),'others',[e for e in extra if e[4]!='<init>' and e[1]!='other'][:12])
