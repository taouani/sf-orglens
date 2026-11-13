"""Lists the custom names in the Apex of a codebase that no reference and no unknown place of a run covers.

    python3 uncovered-names.py <folder of the codebase> <result of run-corpus.ts as JSON> [<pattern>]

A custom name is a word that ends in __c, __r, __e or __mdt and stands outside a comment. The script prints how
many there are, how many are not covered, and how many of those stand where a type stands. The others are
printed with their line, for reading. It was written for the check "references that are missed" of the report
of the Apex trial. The sorting into kinds of place is by patterns of text and is approximate.
"""
import re,sys,os,json
root=sys.argv[1]; res=json.load(open(sys.argv[2]))
covered=set((r['file'],r['line'],r['column']) for r in res['references'])|set((r['file'],r['line'],r['column']) for r in res['unknowns'])
def strip_comments(src):
    out=[];i=0;n=len(src);mode=None
    while i<n:
        c=src[i]
        if mode is None:
            if src.startswith('//',i): mode='l'; out.append('  '); i+=2; continue
            if src.startswith('/*',i): mode='b'; out.append('  '); i+=2; continue
            if c=="'": mode='s'; out.append(c); i+=1; continue
            out.append(c); i+=1
        elif mode=='l':
            if c=='\n': mode=None; out.append(c)
            else: out.append(' ')
            i+=1
        elif mode=='b':
            if src.startswith('*/',i): mode=None; out.append('  '); i+=2; continue
            out.append(c if c=='\n' else ' '); i+=1
        elif mode=='s':
            if c=='\\': out.append(src[i:i+2]); i+=2; continue
            if c=="'": mode=None
            out.append(c); i+=1
    return ''.join(out)
pat=re.compile(sys.argv[3] if len(sys.argv)>3 else r'\b\w+__(?:c|r|e|mdt)\b')
total=0; unc=[]
for d,_,fs in os.walk(root):
    if 'node_modules' in d or '/.' in os.path.relpath(d,root).replace(os.sep,'/').join(['/','']): continue
    for f in sorted(fs):
        if not f.endswith(('.cls','.trigger')): continue
        p=os.path.join(d,f); rel=os.path.relpath(p,root)
        src=strip_comments(open(p,encoding='utf8').read().replace('\r\n','\n'))
        for ln,line in enumerate(src.split('\n'),1):
            for m in pat.finditer(line):
                total+=1
                if (rel,ln,m.start()+1) in covered: continue
                before=line[:m.start()]; after=line[m.end():]
                cls='other'
                if re.search(r'\bnew\s+$',before) or re.search(r'[<,(]\s*$',before) and re.match(r'\s*[>,)\[]',after) and not re.search(r'\bselect\b|\bfrom\b|\bwhere\b',line,re.I) : cls='type'
                if re.match(r'\s*(\[\s*\]\s*)?\w+\s*(=|;|:|\)|,)',after) and not re.search(r"['.]\s*$",before): cls='type'
                if re.match(r'\s*>',after) or re.search(r'<\s*$',before): cls='type'
                if re.search(r'\(\s*$',before) and re.match(r'\s*\)',after): cls='type'
                if re.match(r'\s*\.\s*class\b',after) or re.search(r'\binstanceof\s+$',before) or re.search(r'\bwhen\s+$',before): cls='type'
                if re.search(r'\b(static|public|private|global|protected)\s+$',before): cls='type'
                unc.append((cls,rel,ln,m.start()+1,m.group(0),line.strip()[:120]))
print('occurrences',total,'uncovered',len(unc),'of which type positions',sum(1 for u in unc if u[0]=='type'))
for u in unc:
    if u[0]!='type': print(f'{os.path.basename(u[1])}:{u[2]}:{u[3]} {u[4]} :: {u[5]}')
