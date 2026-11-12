// Deterministic synthetic Salesforce-org model generator (seeded).
import { createHash } from 'node:crypto';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOMAIN = [
  'Account',
  'Contact',
  'Opportunity',
  'Case',
  'Lead',
  'Order',
  'Invoice',
  'Payment',
  'Billing',
  'Shipping',
  'Product',
  'Quote',
  'Contract',
  'Asset',
  'Campaign',
  'Task',
  'Event',
  'User',
  'Territory',
  'Subscription',
  'Renewal',
  'Discount',
  'Approval',
  'Region',
  'Partner',
  'Vendor',
  'Inventory',
  'Warehouse',
  'Shipment',
  'Claim',
  'Policy',
  'Loan',
  'Patient',
  'Visit',
  'Project',
  'Milestone',
  'Timesheet',
  'Expense',
  'Budget',
  'Forecast',
];
const CLS_SUFFIX = [
  'Service',
  'Handler',
  'TriggerHandler',
  'Controller',
  'Selector',
  'Batch',
  'Queueable',
  'Util',
  'Helper',
  'Test',
  'Domain',
  'Scheduler',
];
const VERB = [
  'get',
  'set',
  'update',
  'calculate',
  'validate',
  'process',
  'sync',
  'handle',
  'build',
  'send',
  'create',
  'delete',
  'query',
  'apply',
  'check',
];
const NOUN = [
  'Status',
  'Amount',
  'Date',
  'Owner',
  'Type',
  'Stage',
  'Total',
  'Count',
  'Code',
  'Name',
  'Number',
  'Reason',
  'Source',
  'Score',
  'Rating',
  'Flag',
  'Notes',
  'Region',
  'Email',
  'Phone',
  'Street',
  'City',
];
const FLOW_EL = [
  'Decision',
  'Assignment',
  'RecordLookup',
  'RecordUpdate',
  'RecordCreate',
  'Screen',
  'Loop',
  'ActionCall',
  'Subflow',
];

export function buildUniverse(seed = 42) {
  const rng = mulberry32(seed);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const expInt = (min, mean) => min + Math.floor(-Math.log(1 - rng()) * (mean - min));
  const key = [],
    type = [],
    name = [],
    parent = [],
    top = [],
    path = [];
  const tops = [],
    fields = [],
    methods = [],
    flowEls = [],
    layouts = [],
    classes = [],
    objects = [],
    triggers = [],
    others = [];
  const add = (k, t, n, p, pth) => {
    const i = key.length;
    key.push(k);
    type.push(t);
    name.push(n);
    parent.push(p);
    top.push(p < 0 ? i : top[p]);
    path.push(pth ?? null);
    if (p < 0) tops.push(i);
    return i;
  };
  const F = 1.03; // universe is 3% larger than a snapshot (reserve for "added" components)
  for (let i = 0; i < Math.round(800 * F); i++) {
    const n = i < DOMAIN.length ? DOMAIN[i] : `${pick(DOMAIN)}_${pick(NOUN)}_${i}__c`;
    const o = add(
      `CustomObject:${n}`,
      'CustomObject',
      n,
      -1,
      `force-app/main/default/objects/${n}/${n}.object-meta.xml`,
    );
    objects.push(o);
    const nf = Math.min(500, expInt(10, 50));
    for (let f = 0; f < nf; f++) {
      const fn = `${pick(DOMAIN)}_${pick(NOUN)}_${f}__c`;
      fields.push(add(`CustomField:${n}.${fn}`, 'CustomField', fn, o));
    }
  }
  for (let i = 0; i < Math.round(3000 * F); i++) {
    const n = `${pick(DOMAIN)}${pick(NOUN)}${pick(CLS_SUFFIX)}${i}`;
    const c = add(`ApexClass:${n}`, 'ApexClass', n, -1, `force-app/main/default/classes/${n}.cls`);
    classes.push(c);
    const nm = expInt(3, 20);
    for (let m = 0; m < nm; m++) {
      const mn = `${pick(VERB)}${pick(DOMAIN)}${pick(NOUN)}${m}`;
      methods.push(add(`ApexClass:${n}#method:${mn}`, 'ApexMethod', mn, c));
    }
  }
  for (let i = 0; i < Math.round(400 * F); i++) {
    const n = `${pick(DOMAIN)}Trigger${i}`;
    triggers.push(add(`ApexTrigger:${n}`, 'ApexTrigger', n, -1, `force-app/main/default/triggers/${n}.trigger`));
  }
  for (let i = 0; i < Math.round(1200 * F); i++) {
    const n = `${pick(DOMAIN)}_${pick(VERB)}_${pick(NOUN)}_${i}`;
    const fl = add(`Flow:${n}`, 'Flow', n, -1, `force-app/main/default/flows/${n}.flow-meta.xml`);
    const ne = expInt(5, 30);
    for (let e = 0; e < ne; e++) {
      const en = `${pick(FLOW_EL)}_${pick(NOUN)}_${e}`;
      flowEls.push(add(`Flow:${n}#element:${en}`, 'FlowElement', en, fl));
    }
  }
  for (let i = 0; i < Math.round(1500 * F); i++) {
    const n = `${pick(DOMAIN)}-${pick(DOMAIN)} ${pick(NOUN)} Layout ${i}`;
    layouts.push(add(`Layout:${n}`, 'Layout', n, -1, `force-app/main/default/layouts/${n}.layout-meta.xml`));
  }
  const OTHER = [
    'PermissionSet',
    'Profile',
    'LightningComponentBundle',
    'CustomMetadata',
    'EmailTemplate',
    'Report',
    'CustomLabel',
    'StaticResource',
    'FlexiPage',
    'QuickAction',
  ];
  for (let i = 0; i < Math.round(3100 * F); i++) {
    const t = pick(OTHER);
    const n = `${pick(DOMAIN)}_${pick(NOUN)}_${i}`;
    const o = add(`${t}:${n}`, t, n, -1, `force-app/main/default/${t}/${n}.xml`);
    others.push(o);
    const nc = Math.floor(rng() * 3.6);
    for (let c = 0; c < nc; c++) add(`${t}:${n}#part:${c}`, t + 'Part', `${n}_part_${c}`, o);
  }
  const N = key.length;
  // zipf sampler over a shuffled list
  const zipf = (items, s) => {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const cum = new Float64Array(arr.length);
    let tot = 0;
    for (let i = 0; i < arr.length; i++) {
      tot += 1 / Math.pow(i + 1, s);
      cum[i] = tot;
    }
    return () => {
      const u = rng() * tot;
      let lo = 0,
        hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < u) lo = mid + 1;
        else hi = mid;
      }
      return arr[lo];
    };
  };
  const fieldZ = zipf(fields, 0.9),
    methodZ = zipf(methods, 0.8),
    classZ = zipf(classes, 0.8);
  const KIND = ['read', 'write', 'call', 'flow-read', 'flow-write', 'layout', 'type-ref', 'trigger-on', 'other'];
  const ORIGIN = ['apex-analysis', 'flow-parser', 'xml-parser', 'dependency-api'];
  const M = Math.round(600000 * F);
  const rsrc = new Int32Array(M),
    rdst = new Int32Array(M),
    rkind = new Uint8Array(M),
    rorigin = new Uint8Array(M),
    rconf = new Float32Array(M),
    rline = new Uint16Array(M);
  let r = 0;
  const ref = (s, d, k, o, c) => {
    rsrc[r] = s;
    rdst[r] = d;
    rkind[r] = k;
    rorigin[r] = o;
    rconf[r] = c;
    rline[r] = 1 + Math.floor(rng() * 800);
    r++;
  };
  const q = (n) => Math.round(n * F);
  for (let i = 0; i < q(330000); i++) ref(pick(methods), fieldZ(), rng() < 0.75 ? 0 : 1, 0, rng() < 0.9 ? 1 : 0.7);
  for (let i = 0; i < q(150000); i++) ref(pick(methods), methodZ(), 2, 0, rng() < 0.85 ? 1 : 0.6);
  for (let i = 0; i < q(60000); i++) ref(pick(flowEls), fieldZ(), rng() < 0.7 ? 3 : 4, 1, 1);
  for (let i = 0; i < q(30000); i++) ref(pick(layouts), fieldZ(), 5, 2, 1);
  for (let i = 0; i < q(20000); i++) ref(pick(classes), classZ(), 6, 0, 1);
  while (r < M) {
    if (rng() < 0.3) ref(pick(triggers), pick(objects), 7, 0, 1);
    else ref(pick(others), fieldZ(), 8, 3, 0.5);
  }
  // children + refs-by-src CSR
  const childrenOf = new Map();
  for (let i = 0; i < N; i++)
    if (parent[i] >= 0) {
      const t = top[i];
      let a = childrenOf.get(t);
      if (!a) childrenOf.set(t, (a = []));
      a.push(i);
    }
  const srcStart = new Int32Array(N + 1);
  for (let i = 0; i < M; i++) srcStart[rsrc[i] + 1]++;
  for (let i = 0; i < N; i++) srcStart[i + 1] += srcStart[i];
  const srcRefs = new Int32Array(M);
  {
    const pos = srcStart.slice(0, N);
    for (let i = 0; i < M; i++) srcRefs[pos[rsrc[i]]++] = i;
  }
  const attrs = (i) => {
    switch (type[i]) {
      case 'CustomField':
        return `{"dataType":"Text","length":255,"required":false,"label":"${name[i].replace(/_/g, ' ')}"}`;
      case 'ApexMethod':
        return `{"visibility":"public","static":${i % 2 === 0},"startLine":${(i % 700) + 1},"endLine":${(i % 700) + 30}}`;
      case 'ApexClass':
        return `{"apiVersion":61,"sharing":"with","isTest":${i % 9 === 0}}`;
      case 'FlowElement':
        return `{"elementType":"${name[i].split('_')[0]}"}`;
      default:
        return `{"apiVersion":61}`;
    }
  };
  return {
    N,
    M,
    key,
    type,
    name,
    parent,
    top,
    path,
    tops,
    fields,
    methods,
    childrenOf,
    rsrc,
    rdst,
    rkind,
    rorigin,
    rconf,
    rline,
    srcStart,
    srcRefs,
    KIND,
    ORIGIN,
    attrs,
    rng,
  };
}

export function initialState(u) {
  const alive = new Uint8Array(u.N),
    ver = new Uint16Array(u.N);
  const rng = mulberry32(7);
  for (const t of u.tops) {
    const a = rng() < 1 / 1.03 ? 1 : 0;
    alive[t] = a;
    for (const c of u.childrenOf.get(t) ?? []) alive[c] = a;
  }
  return { alive, ver, rng };
}
// 2% of top-level components modified (file-level granularity: all children re-versioned), 0.3% removed, 0.3% added
export function evolve(u, st) {
  const { alive, ver, rng } = st;
  const aliveTops = u.tops.filter((t) => alive[t]),
    deadTops = u.tops.filter((t) => !alive[t]);
  const sample = (arr, n) => {
    const out = new Set();
    while (out.size < Math.min(n, arr.length)) out.add(arr[Math.floor(rng() * arr.length)]);
    return [...out];
  };
  const setAll = (t, f) => {
    f(t);
    for (const c of u.childrenOf.get(t) ?? []) f(c);
  };
  const mod = sample(aliveTops, Math.round(aliveTops.length * 0.02)),
    rem = sample(aliveTops, Math.round(aliveTops.length * 0.003)),
    addd = sample(deadTops, Math.round(aliveTops.length * 0.003));
  for (const t of mod) setAll(t, (i) => ver[i]++);
  for (const t of rem) setAll(t, (i) => (alive[i] = 0));
  for (const t of addd) setAll(t, (i) => (alive[i] = 1));
  return { modified: mod.length, removed: rem.length, added: addd.length };
}
export const contentHash = (u, i, v) =>
  createHash('sha256')
    .update(u.key[i] + ':' + v)
    .digest();
