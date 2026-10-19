#!/usr/bin/env python3
"""Build the /searchv2 client index from the catalogue database.
Writes public/searchv2-data/{cases.json, vocab.json, manifest.json} (+ .br/.gz). Server-only vectors are built
separately by build-vectors.mjs. Normalisation here must match norm() in public/searchv2-data/worker.js."""
import collections,gzip,hashlib,json,re,sqlite3,subprocess,sys,unicodedata
from pathlib import Path
ROOT=Path('/var/www/website');OUT=ROOT/'public'/'searchv2-data';OUT.mkdir(parents=True,exist_ok=True)
SYN=Path('/root/catalogue/classification-v7/synonyms.json')
def norm(s):
 s=unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower()
 s=s.replace('tumour','tumor').replace('oe','e').replace('ae','e')
 s=re.sub(r'[^a-z0-9]+',' ',s).strip()
 return re.sub(r'\s+',' ',s)
c=sqlite3.connect(f"file:{ROOT/'data-catalogue'/'site.sqlite'}?mode=ro",uri=True);c.row_factory=sqlite3.Row
rows=c.execute("""select c.id,c.title,c.qualifiers,c.url,c.n_slides,c.n_he,c.site_detail,c.source_name,c.age,c.sex,c.category,
 coalesce(nullif(l.clean_label,''),c.title) label,o.name organ,s.name system
 from cases c left join case_labels l on l.case_id=c.id join nodes o on o.id=c.organ_id join nodes s on s.id=c.system_id order by c.id""").fetchall()
idx={r['id']:i for i,r in enumerate(rows)}
# popularity: clicks per normalised title from the search log
pop=collections.Counter()
for line in open(ROOT/'search-logs.txt',encoding='utf-8',errors='replace'):
 p=line.rstrip('\n').split('\t')
 if len(p)>=8 and p[1] not in('MODAL','FEEDBACK') and p[3].strip().isdigit():pop[norm(p[2])]+=1
cases=[];pmax=1
for r in rows:
 lab=r['label'];d={'i':r['id'],'d':lab,'o':r['organ'],'s':r['system'],'src':r['source_name'],'u':r['url'],'n':r['n_slides'],'h':r['n_he']}
 if r['title'] and norm(r['title'])!=norm(lab):d['t']=r['title']
 if r['qualifiers']:d['q']=r['qualifiers'][:160]
 if r['site_detail']:d['sd']=r['site_detail'][:80]
 if r['age']:d['ag']=str(r['age'])[:8]
 if r['sex']:d['sx']=r['sex'][:1].lower()
 if r['category']:d['c']=r['category']
 p=pop.get(norm(lab),0)+(pop.get(norm(r['title']),0) if r['title'] and norm(r['title'])!=norm(lab) else 0)
 if p:d['p']=p;pmax=max(pmax,p)
 cases.append(d)
# vocabulary: normalised term -> (display, kind, set of case idx). Kinds: label, title, who, dx, syn
terms={}
def add(term,display,kind,ids):
 n=norm(term)
 if len(n)<2:return
 e=terms.get(n)
 if e is None:terms[n]=e=[display,kind,set()]
 elif kind=='label' and e[1]!='label':e[0],e[1]=display,kind
 e[2].update(ids)
for r in rows:
 add(r['label'],r['label'],'label',[idx[r['id']]])
 if r['title']:add(r['title'],r['title'],'title',[idx[r['id']]])
for r in c.execute("select n.name,l.case_id from who_outline_links l join who_outline_nodes n on n.organ_id=l.organ_id and n.source_id=l.source_id where n.parent_source_id is not null"):
 if r['case_id'] in idx:add(r['name'],r['name'],'who',[idx[r['case_id']]])
for r in c.execute("select r.name,d.case_id from case_diagnoses d join diagnosis_registry r on r.id=d.term_id where d.certainty='asserted' and r.kind in('neoplastic','non_neoplastic','normal')"):
 if r['case_id'] in idx:add(r['name'],r['name'],'dx',[idx[r['case_id']]])
# hand-written synonyms (catalogue layer): key -> targets; the key inherits every case of a target term
syn=json.loads(SYN.read_text())['synonyms'] if SYN.exists() else {}
for k,targets in syn.items():
 ids=set()
 for t,_rel in targets:
  e=terms.get(norm(t))
  if e:ids|=e[2]
 if ids:add(k,k[:1].upper()+k[1:],'syn',ids)
# abbreviations: "Germ cell neoplasia in situ (GCNIS)" style in labels/titles/registry names + a hand list
abbr={}
def addabbr(a,full):
 a=norm(a);full=norm(full)
 if 2<=len(a)<=8 and full and a!=full and full in terms:abbr.setdefault(a,[]).append(full) if full not in abbr.get(a,[]) else None
for n,e in list(terms.items()):
 m=re.search(r'^(.*?)\s*\(([A-Za-z][A-Za-z0-9\-/]{1,7})\)\s*$',e[0])
 if m and m.group(2).upper()==m.group(2):addabbr(m.group(2),m.group(1))
HAND={'dcis':'ductal carcinoma in situ','lcis':'lobular carcinoma in situ','gist':'gastrointestinal stromal tumour','bph':'benign prostatic hyperplasia','hsil':'high grade squamous intraepithelial lesion','lsil':'low grade squamous intraepithelial lesion','lamn':'low grade appendiceal mucinous neoplasm','cll':'chronic lymphocytic leukaemia','sll':'small lymphocytic lymphoma','mcl':'mantle cell lymphoma','ipmn':'intraductal papillary mucinous neoplasm','dlbcl':'diffuse large b cell lymphoma','niftp':'noninvasive follicular thyroid neoplasm with papillary like nuclear features','hcc':'hepatocellular carcinoma','rcc':'renal cell carcinoma','scc':'squamous cell carcinoma','bcc':'basal cell carcinoma','mpnst':'malignant peripheral nerve sheath tumour','ptc':'papillary thyroid carcinoma','ftc':'follicular thyroid carcinoma','mtc':'medullary thyroid carcinoma','gbm':'glioblastoma','aml':'acute myeloid leukaemia','cml':'chronic myeloid leukaemia','mds':'myelodysplastic syndrome','sft':'solitary fibrous tumour','dfsp':'dermatofibrosarcoma protuberans','afx':'atypical fibroxanthoma','mcc':'merkel cell carcinoma','pecoma':'perivascular epithelioid cell tumour','spn':'solid pseudopapillary neoplasm','sctat':'sex cord tumour with annular tubules','adh':'atypical ductal hyperplasia','udh':'usual ductal hyperplasia','ein':'endometrial intraepithelial neoplasia','cin':'cervical intraepithelial neoplasia','vin':'vulvar intraepithelial neoplasia','pin':'prostatic intraepithelial neoplasia','hgpin':'high grade prostatic intraepithelial neoplasia','gcnis':'germ cell neoplasia in situ','itgcn':'germ cell neoplasia in situ','net':'neuroendocrine tumour','nec':'neuroendocrine carcinoma','ptld':'post transplant lymphoproliferative disorder','lch':'langerhans cell histiocytosis','alcl':'anaplastic large cell lymphoma','malt':'extranodal marginal zone lymphoma','cmv':'cytomegalovirus','hpv':'human papillomavirus','hsv':'herpes simplex','ebv':'epstein barr virus','pcp':'pneumocystis','tb':'tuberculosis','uip':'usual interstitial pneumonia','nsip':'nonspecific interstitial pneumonia','copd':'emphysema','ild':'interstitial lung disease','ibd':'inflammatory bowel disease','uc':'ulcerative colitis','gvhd':'graft versus host disease','sle':'lupus','le':'lupus erythematosus','dle':'discoid lupus erythematosus','pg':'pyogenic granuloma','ga':'granuloma annulare','ks':'kaposi sarcoma','mf':'mycosis fungoides','pxa':'pleomorphic xanthoastrocytoma','dnet':'dysembryoplastic neuroepithelial tumour','pnet':'primitive neuroectodermal tumour','atrt':'atypical teratoid rhabdoid tumour','nlphl':'nodular lymphocyte predominant hodgkin lymphoma','chl':'classic hodgkin lymphoma','pcnsl':'primary cns lymphoma','ews':'ewing sarcoma','ups':'undifferentiated pleomorphic sarcoma','mfh':'undifferentiated pleomorphic sarcoma','wdls':'well differentiated liposarcoma','alt':'atypical lipomatous tumour','gct':'giant cell tumour','tgct':'tenosynovial giant cell tumour','abc':'aneurysmal bone cyst','ewing':'ewing sarcoma','hhv8':'kaposi sarcoma','hiv':'hiv','pbc':'primary biliary cholangitis','psc':'primary sclerosing cholangitis','nash':'steatohepatitis','nafld':'steatosis','fnh':'focal nodular hyperplasia','hnpcc':'lynch syndrome','fap':'familial adenomatous polyposis','ssl':'sessile serrated lesion','ssa':'sessile serrated lesion','tsa':'traditional serrated adenoma','amn':'appendiceal mucinous neoplasm','pmp':'pseudomyxoma peritonei','mesh':'mesothelioma','wt':'wilms tumour','acc':'adrenal cortical carcinoma','pheo':'phaeochromocytoma','pitnet':'pituitary neuroendocrine tumour','ms':'multiple sclerosis','ad':'alzheimer disease','cjd':'creutzfeldt jakob disease','pml':'progressive multifocal leukoencephalopathy','ich':'intracerebral haemorrhage','avm':'arteriovenous malformation','mi':'myocardial infarction','dvt':'thrombus','te':'thromboembolism','pe':'pulmonary embolism','rhd':'rheumatic heart disease','hcm':'hypertrophic cardiomyopathy','dcm':'dilated cardiomyopathy','armm':'arrhythmogenic cardiomyopathy'}
for a,f in HAND.items():
 n=norm(f)
 if n in terms:abbr.setdefault(a,[]);abbr[a].append(n) if n not in abbr[a] else None
 else:
  # fall back to the best prefix term so the abbreviation still expands to something real
  cand=[t for t in terms if t.startswith(n)]
  if cand:best=max(cand,key=lambda t:len(terms[t][2]));abbr.setdefault(a,[]).append(best) if best not in abbr.get(a,[]) else None
termlist=sorted(terms.items())
vocab={'terms':[[n,e[0],e[1],sorted(e[2])] for n,e in termlist],'abbr':abbr}
def write(name,obj):
 raw=json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode()
 (OUT/name).write_bytes(raw);(OUT/(name+'.gz')).write_bytes(gzip.compress(raw,9))
 subprocess.run(['brotli','-f','-q','9','-o',str(OUT/(name+'.br')),str(OUT/name)],check=False)
 return raw
cb=write('cases.json',cases);vb=write('vocab.json',vocab)
version=hashlib.sha1(cb+vb).hexdigest()[:12]
systems=sorted({d['s'] for d in cases});sources=sorted({d['src'] for d in cases})
man={'version':version,'count':len(cases),'terms':len(vocab['terms']),'abbr':len(abbr),'systems':systems,'sources':sources,'casesBytes':len(cb),'vocabBytes':len(vb),'pmax':pmax}
(OUT/'manifest.json').write_text(json.dumps(man))
print(json.dumps({k:v for k,v in man.items() if k not in('systems','sources')}),'| kinds',collections.Counter(e[1] for _,e in termlist))
for f in sorted(OUT.iterdir()):print(f.name,f.stat().st_size)
