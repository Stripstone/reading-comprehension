// Split from original app.js during role-based phase-1 restructure.
// File: library.js
// Note: This is still global-script architecture (no bundler/modules required).

  // LOCAL LIBRARY (IndexedDB)
  // ===================================
  const LOCAL_DB_NAME = 'rc_local_library_v1';
  const LOCAL_DB_VERSION = 1;
  const LOCAL_STORE_BOOKS = 'books';

  let _localDbPromise = null;

  function openLocalDb() {
    if (_localDbPromise) return _localDbPromise;
    _localDbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(LOCAL_STORE_BOOKS)) {
            db.createObjectStore(LOCAL_STORE_BOOKS, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      } catch (e) {
        reject(e);
      }
    });
    return _localDbPromise;
  }

  async function localBooksGetAll() {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('getAll failed'));
    });
  }

  async function localBookGet(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('get failed'));
    });
  }

  async function localBookPut(record) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('put failed'));
    });
  }

  async function localBookDelete(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('delete failed'));
    });
  }

  function isLocalBookId(id) {
    return typeof id === 'string' && id.startsWith('local:');
  }

  function stripLocalPrefix(id) {
    return isLocalBookId(id) ? id.slice('local:'.length) : id;
  }

  async function hashArrayBufferSha256(buf) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const bytes = new Uint8Array(digest);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return b64.slice(0, 22);
    } catch (_) {
      // Fallback: not cryptographically strong, but stable.
      return String(Date.now());
    }
  }

  // ===================================
  // EPUB (client-side) -> Markdown (chapters + pages)
  // Requires JSZip (loaded in index.html)
  // ===================================

  function xmlParseSafe(xmlStr) {
    try {
      return new DOMParser().parseFromString(String(xmlStr || ''), 'application/xml');
    } catch (_) {
      return null;
    }
  }

  function htmlParseSafe(htmlStr) {
    try {
      return new DOMParser().parseFromString(String(htmlStr || ''), 'text/html');
    } catch (_) {
      return null;
    }
  }

  function normPath(p) {
    return String(p || '').replace(/^\//, '');
  }

  function joinPath(baseDir, rel) {
    const b = String(baseDir || '');
    const r = String(rel || '');
    if (!b) return normPath(r);
    if (!r) return normPath(b);
    if (/^https?:/i.test(r)) return r;
    if (r.startsWith('/')) return normPath(r);
    const out = (b.endsWith('/') ? b : (b + '/')) + r;
    // Resolve ./ and ../
    const parts = out.split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  async function zipReadText(zip, path) {
    const f = zip.file(path);
    if (!f) return '';
    return await f.async('text');
  }

  async function epubFindOpfPath(zip) {
    const container = await zipReadText(zip, 'META-INF/container.xml');
    const doc = xmlParseSafe(container);
    if (!doc) return null;
    const rootfile = doc.querySelector('rootfile');
    const fullPath = rootfile?.getAttribute('full-path') || rootfile?.getAttribute('fullpath');
    return fullPath ? normPath(fullPath) : null;
  }

  function dirOf(path) {
    const p = String(path || '');
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.slice(0, idx) : '';
  }

  function classifySection(title) {
    const t = String(title || '').toLowerCase();
    if (!t.trim()) return { type: 'unknown', tags: [] };
    const tags = [];
    let type = 'unknown';
    if (/\bmodule\s+\d+\b/.test(t)) { type = 'chapter'; tags.push('Module'); }
    else if (/\bchapter\b|\bch\.?\s*\d+\b/.test(t) || /^chapter\s+\w+/.test(t)) { type = 'chapter'; tags.push('Chapter'); }
    else if (/\bintroduction\b|\bprologue\b|\bforeword\b|\bcase study\b/.test(t)) { type = 'intro'; tags.push('Intro'); }
    else if (/\backnowledg|\bdedication|\bcopyright|\bpermissions|\babout\b|\bcontents?\b/.test(t)) { type = 'front_matter'; tags.push('Front'); }
    else if (/\bappendix\b|\breferences\b|\bbibliography\b|\bnotes\b/.test(t)) { type = 'appendix'; tags.push('Appendix'); }
    else if (/\bindex\b|\bglossary\b/.test(t)) { type = 'index'; tags.push('Index'); }
    return { type, tags };
  }

  function defaultSelectedForTitle(title) {
    const cls = classifySection(title);
    // Default ON: chapters + intro. Default OFF: front matter / appendix / index.
    if (cls.type === 'chapter' || cls.type === 'intro') return true;
    if (cls.type === 'front_matter' || cls.type === 'appendix' || cls.type === 'index') return false;
    // Unknown: keep on (user can uncheck)
    return true;
  }

  function extractTextBlocksFromHtml(htmlStr) {
    const doc = htmlParseSafe(htmlStr);
    if (!doc) return [];
    const root = doc.body || doc.documentElement;
    if (!root) return [];

    const blocks = [];
    const candidates = root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li');
    candidates.forEach((el) => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      if (txt.length < 2) return;
      blocks.push(txt);
    });
    if (blocks.length === 0) {
      const txt = (root.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) blocks.push(txt);
    }
    return blocks;
  }

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function titleArtifactVariants(title) {
    const s = normalizeTocLabel(title);
    if (!s) return [];
    const out = new Set([s]);
    const noModule = s.replace(/^module\s+\d+\s*/i, '').trim();
    if (noModule && noModule !== s) out.add(noModule);
    const noAppendix = s.replace(/^appendix\s+[a-z]\s*/i, '').trim();
    if (noAppendix && noAppendix !== s) out.add(noAppendix);
    const noCase = s.replace(/^case study\s*/i, '').trim();
    if (noCase && noCase !== s) out.add(noCase);
    return Array.from(out).filter(x => x && x.split(/\s+/).length <= 6);
  }

  
  function looksLikeMajorHeading(text) {
    const s = normalizeTocLabel(text);
    if (!s) return false;
    if (s.length > 140) return false;
    if (/^(participants?|sample|checklist|transcript|question\s+\d+|tips?)\b/i.test(s)) return false;
    if (/:$/.test(s) && !/^(module\s+\d+|appendix\s+[a-z]|case study|introduction|overview|glossary|references|bibliography|notes)\b/i.test(s)) return false;
    if (/^(module\s+\d+\b|appendix\s+[a-z]\b|introduction\b|case study\b|overview\b|glossary\b|references\b|bibliography\b|notes\b|acknowledg)/i.test(s)) return true;
    if (/^[A-Z][A-Za-z0-9'’\-]*(?:\s+[A-Z][A-Za-z0-9'’\-]*){1,8}$/.test(s) && !/[.!?]$/.test(s)) return true;
    return false;
  }

  function removeInlineArtifactTitles(text, knownTitles) {
    let s = String(text || '');
    const vars = Array.isArray(knownTitles) ? knownTitles : [];
    for (const t of vars) {
      const e = escapeRegExp(t);
      if (!e) continue;
      s = s.replace(new RegExp(`(^|\\s)\\d{1,3}\\s+${e}(?=\\s|$)`, 'gi'), ' ');
      s = s.replace(new RegExp(`(^|\\s)${e}\\s+\\d{1,3}(?=\\s|$)`, 'gi'), ' ');
    }
    return s;
  }

  
  function repairWrappedWordFragments(text) {
    let s = String(text || '');
    // Preserve real hyphenated compounds that were split by a line wrap.
    s = s.replace(/\b([A-Za-z]{2,})-\s+([A-Za-z]{2,}-[A-Za-z][A-Za-z\-]*)\b/g, '$1-$2');
    // Repair ordinary wrapped words like iden- tifier, modera- tor, dis- cussion.
    s = s.replace(/\b([A-Za-z]{2,})\s*-\s+([a-z]{2,})\b/g, (m, a, b) => {
      const joined = `${a}${b}`;
      if (joined.length > 28) return `${a}-${b}`;
      return joined;
    });
    s = s.replace(/\b([A-Za-z]{2,})-\s+([a-z]{2,})\b/g, (m, a, b) => {
      const joined = `${a}${b}`;
      if (joined.length > 28) return `${a}-${b}`;
      return joined;
    });
    return s;
  }

  
  function cleanImportedBlock(text, { bookTitle = '', artifactTitles = [] } = {}) {
    let s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';

    // Remove decorative spaced headings like "T I P S" before the real heading text.
    s = s.replace(/^(?:[A-Z]\s+){2,}[A-Z](?=\s+[A-Z][a-z])\s+/, '');
    s = s.replace(/\((?:contd\.?|continued)\)/gi, '');
    s = fixLeadingDropCapSpacing(s);
    s = repairWrappedWordFragments(s);
    s = s.replace(/\bcontinued on page\s+\d+\b/gi, ' ');

    const known = [];
    if (bookTitle) known.push(bookTitle);
    (artifactTitles || []).forEach(t => titleArtifactVariants(t).forEach(v => known.push(v)));
    s = removeInlineArtifactTitles(s, known);

    if (bookTitle) {
      const e = escapeRegExp(bookTitle);
      s = s.replace(new RegExp(`^\\s*\\d{1,3}\\s+${e}\\s*`, 'i'), '');
      s = s.replace(new RegExp(`^\\s*${e}\\s+\\d{1,3}\\s*`, 'i'), '');
      s = s.replace(new RegExp(`\\b${e}\\b`, 'gi'), ' ');
    }

    // Strip common running-head / side-label artifacts seen in handbook-style EPUBs.
    s = s.replace(/\b(?:overview|focus groups|in-depth interviews|interview checklist|sampling in qualitative research|qualitative research methods|case study)\s+\d{1,3}\b/gi, ' ');
    s = s.replace(/\b\d{1,3}\s+(?:overview|focus groups|in-depth interviews|interview checklist|sampling in qualitative research|qualitative research methods|case study)\b/gi, ' ');
    s = s.replace(/\b(?:FOCUS|GROUPS|OVERVIEW|TIPS|CASE\s+STUDY)\b(?=\s+[A-Z][a-z])/g, ' ');
    s = s.replace(/^\s*\d{1,3}\s+/, '');
    s = s.replace(/\s+/g, ' ').trim();

    if (!s) return '';
    if (/^(?:continued on page\s+\d+|page\s+\d+)$/i.test(s)) return '';
    if (bookTitle && titleKey(s) === titleKey(bookTitle)) return '';
    if (/^(?:[ivxlcdm]+|\d{1,3})$/i.test(s)) return '';
    return s;
  }

  // Import cleanup helpers (deterministic, build-safe)
  function fixLeadingDropCapSpacing(text) {
    let s = String(text || '');
    // Drop-cap join (locked): only repair obvious one-letter ornamental splits at block start.
    // Keep true standalone words intact, especially articles/pronouns like "A" and "I".
    const skip = new Set(['A', 'I']);
    const joinLeadingDropCap = (source) => source.replace(
      /^(?:(["“\'\(\[]\s*))?([A-Z])\s+([a-z][a-z]+)(?=\b)/,
      (m, pre = '', cap, frag) => {
        if (skip.has(cap)) return m;
        return `${pre}${cap}${frag}`;
      }
    );
    s = joinLeadingDropCap(s);
    return s;
  }

  
  function mergeFragmentedBlocks(blocks) {
    const out = [];
    const listLineRe = /^\s*(\d+[\.|\)]\s+|box\s+\d+\s*:|line\s+\d+\s*:|part\s+[ivxlcdm]+\b|[-•*]\s+)/i;
    const strongEndRe = /[.!?]["'”’\)\]\}]*\s*$/;
    const weakTailRe = /(?:,|;|:)\s*$/;
    const startsContinuationRe = /^\s*(?:[a-z]|\(|\[|\{|and\b|or\b|but\b|nor\b|for\b|so\b|yet\b|because\b|which\b|who\b|whom\b|whose\b|that\b|to\b|of\b|in\b|on\b|at\b|by\b|from\b|with\b|without\b|under\b|over\b|between\b|among\b|through\b|into\b|onto\b)/i;

    for (let i = 0; i < (blocks || []).length; i++) {
      const cur = String(blocks[i] || '').trim();
      if (!cur) continue;
      if (out.length === 0) { out.push(cur); continue; }

      const prev = out[out.length - 1];
      if (listLineRe.test(prev) || listLineRe.test(cur) || looksLikeMajorHeading(cur) || looksLikeMajorHeading(prev)) {
        out.push(cur);
        continue;
      }

      if (/\b[A-Za-z]{2,}-$/.test(prev) && /^\s*[a-z]{2,}/.test(cur)) {
        out[out.length - 1] = (prev.replace(/-\s*$/, '') + cur.replace(/^\s+/, '')).replace(/\s+/g, ' ').trim();
        continue;
      }

      if (((prev.length < 120 && !strongEndRe.test(prev)) || weakTailRe.test(prev)) && startsContinuationRe.test(cur)) {
        out[out.length - 1] = (prev + ' ' + cur).replace(/\s+/g, ' ').trim();
        continue;
      }
      out.push(cur);
    }
    return out;
  }

  function isDecorativeSpacedHeading(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (s.length > 80) return false;
    if (/[a-z]/.test(s)) return false; // if it has lowercase, it's not the decorative spaced heading style

    // Many single-letter uppercase tokens separated by spaces (e.g., "C H A P T E R O N E")
    const singleLetterTokens = (s.match(/\b[A-Z]\b/g) || []).length;
    if (singleLetterTokens >= 6) return true;

    // Or a tight pattern of "A B C D" letters across the line
    if (/^(?:[A-Z]\s+){5,}[A-Z]$/.test(s)) return true;

    return false;
  }

  
  function chunkBlocksToPages(blocks, targetChars = 1600) {
    const pagesOut = [];
    const target = Math.max(400, targetChars | 0);
    const minChars = Math.max(240, Math.round(target * 0.58));
    const softMax = Math.round(target * 1.12);
    const hardMax = Math.max(softMax + 240, Math.round(target * 3.2));
    const searchBack = Math.max(640, Math.round(target * 0.72));
    const searchForward = Math.max(900, Math.round(target * 0.75));
    const closers = new Set(['"', "'", '”', '’', ')', ']', '}']);
    const plainWordRe = /^[A-Za-z]+(?:['’][A-Za-z]+)?$/;
    const listLineRe = /^\s*(?:\d+[.)]\s+|[-•*]\s+|box|line|part)/i;

    function normalizeSpace(s) {
      return String(s || '').replace(/\s+/g, ' ').trim();
    }

    function isListLine(s) {
      return listLineRe.test(String(s || '').trim());
    }

    function isProtectedBoundary(prevText, nextText) {
      return isListLine(prevText) || isListLine(nextText) || looksLikeMajorHeading(prevText) || looksLikeMajorHeading(nextText);
    }

    function rawTokens(s) {
      return normalizeSpace(s).split(' ').filter(Boolean);
    }

    function plainWordCount(tokens) {
      return (tokens || []).filter(t => plainWordRe.test(t)).length;
    }

    function startsLikeContinuation(text) {
      const h = normalizeSpace(text).slice(0, 90);
      if (!h) return false;
      if (looksLikeMajorHeading(h) || isListLine(h)) return false;
      if (/^[,;:.!?\)\]\}]/.test(h)) return true;
      if (/^\(/.test(h)) return true;
      const toks = rawTokens(h).slice(0, 4);
      if (toks.length && plainWordCount(toks) < 3) return true;
      if (toks.slice(0, 3).some(t => !plainWordRe.test(t))) return true;
      return false;
    }

    function collectSentenceStops(text, limit = text.length) {
      const t = String(text || '');
      const stops = [];
      let paren = 0, bracket = 0, brace = 0;
      let straightDouble = false;
      let curlyDouble = 0;
      for (let i = 0; i < Math.min(limit, t.length); i++) {
        const ch = t[i];
        const prev = i > 0 ? t[i - 1] : '';
        if (ch === '"' && prev !== '\\') { straightDouble = !straightDouble; continue; }
        if (ch === '“') { curlyDouble += 1; continue; }
        if (ch === '”') { curlyDouble = Math.max(0, curlyDouble - 1); continue; }
        if (ch === '(') { paren += 1; continue; }
        if (ch === ')') { paren = Math.max(0, paren - 1); continue; }
        if (ch === '[') { bracket += 1; continue; }
        if (ch === ']') { bracket = Math.max(0, bracket - 1); continue; }
        if (ch === '{') { brace += 1; continue; }
        if (ch === '}') { brace = Math.max(0, brace - 1); continue; }
        if (paren || bracket || brace || straightDouble || curlyDouble) continue;
        if (ch !== '.' && ch !== '?' && ch !== '!') continue;
        let end = i + 1;
        while (end < t.length && closers.has(t[end])) end += 1;
        while (end < t.length && /\s/.test(t[end])) end += 1;
        stops.push({ cut: end, punct: i, ch });
      }
      return stops;
    }

    function boundaryMetrics(text, cand) {
      const left = normalizeSpace(text.slice(0, cand.cut));
      const right = normalizeSpace(text.slice(cand.cut));
      const preSnippet = normalizeSpace(text.slice(Math.max(0, cand.punct - 180), cand.punct));
      const postSnippet = normalizeSpace(text.slice(cand.cut, Math.min(text.length, cand.cut + 180)));
      const preTokens = rawTokens(preSnippet);
      const postTokens = rawTokens(postSnippet);
      const last8 = preTokens.slice(-8);
      const first5 = postTokens.slice(0, 5);
      const lastToken = preTokens[preTokens.length - 1] || '';
      const lastPlain3 = [];
      for (let i = preTokens.length - 1; i >= 0 && lastPlain3.length < 3; i--) {
        if (plainWordRe.test(preTokens[i])) lastPlain3.unshift(preTokens[i]);
      }
      const firstPlain3 = postTokens.filter(t => plainWordRe.test(t)).slice(0, 3);
      const rawTail = preSnippet.slice(-90);
      const rawHead = postSnippet.slice(0, 90);
      const beforePlain = lastPlain3.length;
      const afterPlain = firstPlain3.length;
      const finalPlainWord = (lastPlain3[lastPlain3.length - 1] || '').toLowerCase();
      const firstAfterPlainWord = (firstPlain3[0] || '').toLowerCase();
      const shortFinal = plainWordRe.test(lastToken) && lastToken.length <= 3;
      const dottedTail = /(?:\b[A-Za-z]\.){2,}$/.test(rawTail) || /[A-Za-z0-9-]+\.[A-Za-z0-9.-]+$/.test(rawTail);
      const legalTail = /(?:§\s*)?\d+(?:\.\d+)+(?:\s*\([a-z0-9]+\))*$/.test(rawTail) || /\b(?:vol|chap|sec|no|art)\.$/i.test(rawTail);
      const afterStructured = /^\(|^\d/.test(rawHead) || first5.slice(0, 3).some(t => !plainWordRe.test(t));
      const commaLikeTail = /[,;:]\s*$/.test(rawTail) || /[,;:]/.test(last8.join(' '));
      const weirdTail = /[§$@#%^&*_+=<>|~\/\[\]{}]/.test(last8.join(' '));
      const initialChain = /(?:^|\s)(?:[A-Za-z]\.|[A-Za-z]{1,4}\.)\s*(?:[A-Za-z]\.|[A-Za-z]{1,4}\.)/.test(rawTail);
      const dateLikeTail = /^\d+$/.test(lastToken) || /\d{1,4},?\s+\d{1,4}$/.test(rawTail);
      const weakTailWord = /^(?:the|a|an|and|or|but|of|to|for|in|on|at|by|with|from)$/i.test(finalPlainWord);
      const weakHeadWord = /^(?:and|or|but|of|to|for|in|on|at|by|with|from)$/i.test(firstAfterPlainWord);
      const tailPunctDensity = (rawTail.match(/[^A-Za-z'\s]/g) || []).length;
      const headPunctDensity = (rawHead.match(/[^A-Za-z'\s]/g) || []).length;
      const preWindow = normalizeSpace(text.slice(Math.max(0, cand.punct - 260), cand.punct));
      const postWindow = normalizeSpace(text.slice(cand.cut, Math.min(text.length, cand.cut + 260)));
      const structuralRun = ((preWindow.match(/[,;:]/g) || []).length + (postWindow.match(/[,;:]/g) || []).length);
      const sentenceBackIdx = Math.max(preWindow.lastIndexOf('. '), preWindow.lastIndexOf('? '), preWindow.lastIndexOf('! '));
      const segmentTail = sentenceBackIdx >= 0 ? preWindow.slice(sentenceBackIdx + 2) : preWindow;
      const segmentTokens = rawTokens(segmentTail);
      const segmentLen = segmentTokens.length;
      const segmentPunct = (segmentTail.match(/[^A-Za-z'\s]/g) || []).length;
      const nextWindow = normalizeSpace(text.slice(cand.cut, Math.min(text.length, cand.cut + 520)));
      const nextDensePunct = (nextWindow.match(/[,;:()\[\]{}"“”]/g) || []).length;
      const nextDenseSignals = (nextWindow.match(/(?:article|chapter|section|treaty|whereas|provided|commissioners|esq(?:uire)?s?|vol\.?|no\.?|page|law library|project)/ig) || []).length;
      const nextDenseLookahead = nextDensePunct + (nextDenseSignals * 6);
      const traversed = cand.cut > target ? normalizeSpace(text.slice(target, cand.cut)) : '';
      const traversedPunct = (traversed.match(/[^A-Za-z'\s]/g) || []).length;
      const traversedDense = ((traversed.match(/[,;:()\[\]{}"“”]/g) || []).length) + (((traversed.match(/(?:article|chapter|section|treaty|whereas|provided|commissioners|esq(?:uire)?s?|vol\.?|no\.?|page|law library|project)/ig) || []).length) * 6);
      return { left, right, beforePlain, afterPlain, finalPlainWord, firstAfterPlainWord, shortFinal, dottedTail, legalTail, afterStructured, commaLikeTail, weirdTail, initialChain, dateLikeTail, weakTailWord, weakHeadWord, tailPunctDensity, headPunctDensity, structuralRun, segmentLen, segmentPunct, nextDenseLookahead, traversedPunct, traversedDense };
    }

    function isHardInvalid(m) {
      if (!m.left || !m.right) return true;
      if (isProtectedBoundary(m.left, m.right)) return true;
      if (m.beforePlain < 3) return true;
      if (m.afterPlain < 3) return true;
      if (m.shortFinal && !m.dateLikeTail) return true;
      if (m.weakTailWord || m.weakHeadWord) return true;
      if (m.dottedTail || m.legalTail || m.initialChain) return true;
      if (m.afterStructured) return true;
      if (startsLikeContinuation(m.right)) return true;
      return false;
    }

    function scoreCandidate(text, cand) {
      const m = boundaryMetrics(text, cand);
      if (isHardInvalid(m)) return null;
      let score = 0;
      // Reward clean prose on both sides.
      score += Math.min(m.beforePlain, 3) * 16;
      score += Math.min(m.afterPlain, 3) * 14;
      if (!m.commaLikeTail) score += 20;
      if (!m.weirdTail) score += 12;

      // Prefer simpler, shorter sentence segments over dense structured spans.
      score -= m.tailPunctDensity * 5.5;
      score -= m.headPunctDensity * 3.2;
      score -= m.structuralRun * 4.6;
      score -= Math.max(0, m.segmentLen - 16) * 3.4;
      score -= m.segmentPunct * 4.0;
      if (m.segmentLen <= 14 && m.segmentPunct <= 1) score += 34;
      else if (m.segmentLen <= 20 && m.segmentPunct <= 3) score += 16;
      else if (m.segmentLen <= 28 && m.segmentPunct <= 5) score += 6;
      if (m.dateLikeTail) score -= 18; // acceptable but weaker than plain prose

      // Strongly reward clean stops that occur just before dense quoted/legal/citation spans.
      score += Math.min(90, m.nextDenseLookahead * 0.7);

      // Soft target fit. Respect the target when reasonable, but do not reward carrying the page
      // deep into dense spans just because a later stop remains technically valid.
      const delta = cand.cut - target;
      if (delta <= 0) {
        score += 28;
        score -= Math.abs(delta) / 15;
      } else {
        score -= delta / 9;
        score -= Math.max(0, delta - Math.round(target * 0.06)) / 2.6;
        score -= m.traversedPunct * 1.2;
        score -= Math.min(120, m.traversedDense * 0.9);
      }
      return { cut: cand.cut, score, delta };
    }

    function chooseCut(text) {
      const t = String(text || '').trim();
      if (!t) return -1;
      const center = Math.min(t.length, target);
      const startAt = Math.max(minChars, center - searchBack);
      const limit = Math.min(t.length, center + searchForward);
      const all = collectSentenceStops(t, t.length).filter(c => c.cut >= minChars);
      const near = all.filter(c => c.cut >= startAt && c.cut <= limit).map(c => scoreCandidate(t, c)).filter(Boolean);
      if (near.length) {
        const before = near.filter(c => c.cut <= target).sort((a, b) => b.score - a.score || b.cut - a.cut);
        const after = near.filter(c => c.cut > target).sort((a, b) => b.score - a.score || a.cut - b.cut);
        const bestBefore = before[0] || null;
        const bestAfter = after[0] || null;
        if (bestBefore && bestAfter) {
          // Prefer earlier clean prose unless the later candidate is materially better.
          const beforeAdjusted = bestBefore.score + 18;
          const afterAdjusted = bestAfter.score - Math.min(42, Math.max(0, bestAfter.delta) / 14);
          if (beforeAdjusted >= afterAdjusted) return bestBefore.cut;
          return bestAfter.cut;
        }
        if (bestBefore) return bestBefore.cut;
        if (bestAfter) return bestAfter.cut;
      }
      const back = all.filter(c => c.cut >= minChars && c.cut < startAt).map(c => scoreCandidate(t, c)).filter(Boolean).sort((a, b) => b.score - a.score || b.cut - a.cut);
      if (back.length) return back[0].cut;
      const forward = all.filter(c => c.cut > limit).map(c => scoreCandidate(t, c)).filter(Boolean).sort((a, b) => b.score - a.score || a.cut - b.cut);
      if (forward.length) return forward[0].cut;
      return -1;
    }

    function flushBuffer(force = false) {
      let t = String(buf || '').trim();
      while (t) {
        if (!force && t.length <= softMax) break;
        let cut = chooseCut(t);
        if (cut < 0 && !force) break;
        if (cut <= 0 || cut >= t.length) {
          if (force) {
            pagesOut.push(t.trim());
            t = '';
          }
          break;
        }
        const page = t.slice(0, cut).trim();
        const rest = t.slice(cut).trim();
        if (!page) break;
        pagesOut.push(page);
        t = rest;
      }
      buf = t;
    }

    const cleanBlocks = (blocks || []).map(b => String(b || '').trim()).filter(Boolean);
    let buf = '';

    for (let i = 0; i < cleanBlocks.length; i++) {
      const block = cleanBlocks[i];
      if (looksLikeMajorHeading(block) && buf.length >= minChars) {
        flushBuffer(true);
      }
      buf = buf ? `${buf}

${block}` : block;
      flushBuffer(false);
      if (buf.length > hardMax) flushBuffer(false);
    }

    flushBuffer(true);

    const merged = [];
    for (const p of pagesOut) {
      const page = String(p || '').trim();
      if (!page) continue;
      if (!merged.length) { merged.push(page); continue; }
      const prev = merged[merged.length - 1];
      if (page.length < minChars && (prev.length + 2 + page.length) <= hardMax && !isProtectedBoundary(prev, page)) {
        merged[merged.length - 1] = `${prev}

${page}`.trim();
      } else {
        merged.push(page);
      }
    }
    return merged;
  }
  function buildMarkdownBookFromSections(sections, { pageChars = 1600 } = {}) {
    const out = [];
    (sections || []).forEach((sec) => {
      const title = (sec?.title || 'Untitled Section').trim();
      out.push(`# ${title}`);
      out.push('');
      const pages = chunkBlocksToPages(sec?.blocks || [], pageChars);
      pages.forEach((p, idx) => {
        out.push(`## Page ${idx + 1}`);
        out.push('');
        out.push(p);
        out.push('');
      });
      out.push('');
    });
    return out.join('\n');
  }

  function _normEpubHref(href) {
    return String(href || '')
      .split('#')[0]
      .replace(/^\.\//, '')
      .replace(/^\//, '');
  }


  function normalizeTocLabel(text) {
    let s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/[–—]/g, ' - ');
    s = s.replace(/\s+/g, ' ').trim();
    // Strip trailing printed page references from front-matter contents lines.
    s = s.replace(/\s+(?:\d+[\d,\-– ]*|[ivxlcdm]+)\s*$/i, '').trim();
    s = s.replace(/\s*\.+\s*(?:\d+[\d,\-– ]*|[ivxlcdm]+)\s*$/i, '').trim();
    return s;
  }

  function titleKey(text) {
    return normalizeTocLabel(text)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function weakTocTitle(title) {
    const k = titleKey(title);
    return !k || /^(start|unknown|cover|title page|contents?|toc|untitled|beginning)$/.test(k);
  }

  function tocLooksWeak(items, spineHrefs) {
    const arr = Array.isArray(items) ? items.filter(Boolean) : [];
    if (arr.length === 0) return true;
    if (arr.length <= 2) return true;
    const weakCount = arr.filter(it => weakTocTitle(it.title)).length;
    if (weakCount >= Math.max(1, arr.length - 1)) return true;
    const uniqueHrefs = new Set(arr.map(it => _normEpubHref(it.href)).filter(Boolean));
    if (uniqueHrefs.size <= 1 && (spineHrefs || []).length > 1) return true;
    return false;
  }

  function looksLikeMajorSectionTitle(text) {
    const s = normalizeTocLabel(text);
    if (!s) return false;
    if (s.length > 120) return false;
    if (/[.!?]$/.test(s)) return false;
    return /^(acknowledg|introduction\b|case study\b|module\s+\d+\b|appendix\s+[a-z]\b|glossary\b|references\b|bibliography\b|notes\b)/i.test(s);
  }

  function findTocShapedLines(blocks) {
    const out = [];
    let inContents = false;
    for (const raw of (blocks || [])) {
      const t = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (!inContents && /^(contents|table of contents)$/i.test(t)) { inContents = true; continue; }
      if (!inContents) continue;
      const label = normalizeTocLabel(t);
      if (!label) continue;
      if (looksLikeMajorSectionTitle(label)) out.push(label);
      // Stop when we leave the compact list and enter obvious prose.
      if (out.length >= 3 && /[.!?]$/.test(t) && t.split(/\s+/).length > 12) break;
    }
    return out;
  }

  function majorTitleVariants(title) {
    const raw = normalizeTocLabel(title);
    const key = titleKey(raw);
    const vars = new Set([raw, key]);
    const m = key.match(/^(module\s+\d+)\b/);
    if (m) vars.add(m[1]);
    const a = key.match(/^(appendix\s+[a-z])\b/);
    if (a) vars.add(a[1]);
    if (/^case study\b/.test(key)) vars.add('case study');
    if (/^introduction\b/.test(key)) vars.add('introduction');
    if (/^glossary\b/.test(key)) vars.add('glossary');
    if (/^acknowledg/.test(key)) vars.add('acknowledgments');
    return Array.from(vars).filter(Boolean);
  }

  function findBlockIndexForTitle(blocks, title) {
    const vars = majorTitleVariants(title);
    if (!vars.length) return -1;
    for (let i = 0; i < (blocks || []).length; i++) {
      const bk = titleKey(blocks[i]);
      if (!bk) continue;
      if (vars.some(v => bk === v || bk.startsWith(v + ' ') || bk.includes(' ' + v + ' '))) return i;
    }
    return -1;
  }

  async function rebuildTocFromFrontMatter(zip, spineHrefs) {
    const spine = Array.isArray(spineHrefs) ? spineHrefs.map(_normEpubHref) : [];
    if (!spine.length) return [];

    const candidateTitles = [];
    // 1) Look for an explicit Contents page near the front.
    for (let i = 0; i < Math.min(3, spine.length); i++) {
      const html = await zipReadText(zip, spine[i]);
      const blocks = extractTextBlocksFromHtml(html);
      const lines = findTocShapedLines(blocks);
      lines.forEach(t => candidateTitles.push(t));
      if (lines.length >= 3) break;
    }

    // 2) Fallback: recover major headings from body text across the spine.
    if (candidateTitles.length < 3) {
      for (let i = 0; i < spine.length; i++) {
        const html = await zipReadText(zip, spine[i]);
        const blocks = extractTextBlocksFromHtml(html);
        for (const b of blocks) {
          const label = normalizeTocLabel(b);
          if (looksLikeMajorSectionTitle(label)) candidateTitles.push(label);
        }
      }
    }

    // De-dupe while preserving order.
    const seen = new Set();
    const major = [];
    for (const t of candidateTitles) {
      const k = titleKey(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      major.push(t);
    }
    if (!major.length) return [];

    // Map each candidate title to the first matching spine doc and block index.
    const blockCache = new Map();
    const items = [];
    let lastSpineIdx = -1;
    for (const title of major) {
      let found = null;
      for (let s = Math.max(0, lastSpineIdx); s < spine.length; s++) {
        let blocks = blockCache.get(spine[s]);
        if (!blocks) {
          const html = await zipReadText(zip, spine[s]);
          blocks = extractTextBlocksFromHtml(html);
          blockCache.set(spine[s], blocks);
        }
        const idx = findBlockIndexForTitle(blocks, title);
        const matched = idx >= 0 && blocks[idx] && majorTitleVariants(title).some(v => { const bk = titleKey(blocks[idx]); return bk === v || bk.startsWith(v + ' ') || bk.includes(' ' + v + ' '); });
        if (matched) {
          found = { title, href: spine[s], blockIndex: idx };
          lastSpineIdx = s;
          break;
        }
      }
      if (found) items.push(found);
    }

    // Drop duplicates that map to the same spot.
    const finalSeen = new Set();
    return items.filter((it) => {
      const k = `${_normEpubHref(it.href)}|${it.blockIndex}|${titleKey(it.title)}`;
      if (finalSeen.has(k)) return false;
      finalSeen.add(k);
      return true;
    });
  }

  async function epubParseToc(zip, opfPath) {
    const opfText = await zipReadText(zip, opfPath);
    const opf = xmlParseSafe(opfText);
    if (!opf) return { metadata: {}, items: [] };

    const baseDir = dirOf(opfPath);
    const md = {};
    const titleEl = opf.querySelector('metadata > title, metadata > dc\\:title, dc\\:title');
    const creatorEl = opf.querySelector('metadata > creator, metadata > dc\\:creator, dc\\:creator');
    md.title = (titleEl?.textContent || '').trim();
    md.author = (creatorEl?.textContent || '').trim();

    // Build manifest map
    const manifest = new Map();
    opf.querySelectorAll('manifest > item').forEach((it) => {
      const id = it.getAttribute('id') || '';
      const href = it.getAttribute('href') || '';
      const mediaType = it.getAttribute('media-type') || it.getAttribute('mediaType') || '';
      const props = it.getAttribute('properties') || '';
      if (!id || !href) return;
      manifest.set(id, { id, href: joinPath(baseDir, href), mediaType, props });
    });

    // Spine order (used to extract full chapter ranges)
    const spineIds = [];
    opf.querySelectorAll('spine > itemref').forEach((it) => {
      const idref = it.getAttribute('idref');
      if (idref) spineIds.push(idref);
    });
    const spineHrefs = spineIds
      .map((idref) => manifest.get(idref)?.href)
      .filter(Boolean)
      .map(_normEpubHref);

    // EPUB3 nav
    const navItem = Array.from(manifest.values()).find(v => /\bnav\b/.test(v.props || ''));
    if (navItem) {
      const navHtml = await zipReadText(zip, navItem.href);
      const navDoc = htmlParseSafe(navHtml);
      const tocNav = navDoc?.querySelector('nav[epub\\:type="toc"], nav[epub\\:type="toc" i], nav[type="toc"], nav#toc');
      const links = tocNav ? tocNav.querySelectorAll('a[href]') : navDoc?.querySelectorAll('a[href]');
      const items = [];
      (links ? Array.from(links) : []).forEach((a) => {
        const href = a.getAttribute('href') || '';
        const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!href || !title) return;
        const cleanHref = href.split('#')[0];
        if (!cleanHref) return;
        const full = joinPath(dirOf(navItem.href), cleanHref);
        items.push({ title, href: full });
      });
      // De-dupe
      const seen = new Set();
      const uniq = [];
      for (const it of items) {
        const k = it.title + '|' + it.href;
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(it);
      }
      if (!tocLooksWeak(uniq, spineHrefs)) return { metadata: md, items: uniq, spineHrefs };
    }

    // EPUB2 NCX
    const spine = opf.querySelector('spine');
    const tocId = spine?.getAttribute('toc') || '';
    const tocItem = tocId ? manifest.get(tocId) : null;
    if (tocItem) {
      const ncxText = await zipReadText(zip, tocItem.href);
      const ncx = xmlParseSafe(ncxText);
      const navPoints = ncx ? Array.from(ncx.querySelectorAll('navPoint')) : [];
      const items = [];
      navPoints.forEach((np) => {
        const t = (np.querySelector('navLabel > text')?.textContent || '').trim();
        const src = (np.querySelector('content')?.getAttribute('src') || '').trim();
        if (!t || !src) return;
        const cleanHref = src.split('#')[0];
        const full = joinPath(dirOf(tocItem.href), cleanHref);
        items.push({ title: t, href: full });
      });
      if (!tocLooksWeak(items, spineHrefs)) return { metadata: md, items, spineHrefs };
    }

    const rebuilt = await rebuildTocFromFrontMatter(zip, spineHrefs);
    if (rebuilt.length) return { metadata: md, items: rebuilt, spineHrefs };

    // Worst-case: fall back to spine order
    const items = spineHrefs.map((href, i) => ({ title: `Section ${i + 1}`, href }));
    return { metadata: md, items, spineHrefs };
  }

  async function epubToMarkdownFromSelected(zip, tocItems, selectedIds, spineHrefs, { pageChars = 1600, cleanupHeadings = false, onProgress = null, bookTitle = '' } = {}) {
    // Extract each selected TOC item as a range in spine order: from its start file until next TOC start.
    const toc = (tocItems || [])
      .slice()
      .filter(x => x && x.href)
      .map((x, idx) => ({ ...x, _order: idx, _hrefNorm: _normEpubHref(x.href) }));

    const spine = Array.isArray(spineHrefs) ? spineHrefs.map(_normEpubHref) : [];
    const hrefToSpineIndex = new Map(spine.map((h, i) => [h, i]));
    toc.forEach((it) => {
      it.spineIndex = hrefToSpineIndex.has(it._hrefNorm) ? hrefToSpineIndex.get(it._hrefNorm) : null;
      it.blockIndex = Number.isFinite(it.blockIndex) ? Math.max(0, it.blockIndex) : null;
    });

    const chosen = toc.filter(it => selectedIds.has(it.id) && typeof it.spineIndex === 'number');
    chosen.sort((a, b) => a._order - b._order);

    const sections = [];
    let done = 0;
    for (let i = 0; i < chosen.length; i++) {
      const it = chosen[i];
      // Find the next TOC item after this one (regardless of selection) that has a spine index.
      let endSpine = spine.length;
      for (let j = it._order + 1; j < toc.length; j++) {
        const nxt = toc[j];
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > it.spineIndex) {
          endSpine = nxt.spineIndex;
          break;
        }
      }

      const blocks = [];
      let nextSameSpine = null;
      for (let j = it._order + 1; j < toc.length; j++) {
        const nxt = toc[j];
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex === it.spineIndex && Number.isFinite(nxt.blockIndex)) {
          nextSameSpine = nxt;
          break;
        }
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > it.spineIndex) break;
      }

      for (let s = it.spineIndex; s < endSpine; s++) {
        const href = spine[s];
        const html = await zipReadText(zip, href);
        let cleaned = extractTextBlocksFromHtml(html)
          .map(b => cleanImportedBlock(b, { bookTitle, artifactTitles: toc.map(x => x.title) }))
          .filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)));
        cleaned = mergeFragmentedBlocks(cleaned);
        cleaned = cleaned.filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)));

        let startIdx = 0;
        let endIdx = cleaned.length;
        if (s === it.spineIndex && Number.isFinite(it.blockIndex)) startIdx = Math.min(cleaned.length, Math.max(0, it.blockIndex));
        if (s === it.spineIndex && nextSameSpine && Number.isFinite(nextSameSpine.blockIndex)) endIdx = Math.min(endIdx, Math.max(startIdx, nextSameSpine.blockIndex));
        if (s === endSpine - 1 && !nextSameSpine) {
          // If the next TOC item starts inside the same final spine doc, stop there.
          for (let j = it._order + 1; j < toc.length; j++) {
            const nxt = toc[j];
            if (typeof nxt.spineIndex === 'number' && nxt.spineIndex === s && Number.isFinite(nxt.blockIndex)) {
              endIdx = Math.min(endIdx, Math.max(startIdx, nxt.blockIndex));
              break;
            }
            if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > s) break;
          }
        }
        for (let bi = startIdx; bi < endIdx; bi++) blocks.push(cleaned[bi]);
      }
      sections.push({ title: it.title, blocks });
      done++;
      if (typeof onProgress === 'function') onProgress({ done, total: chosen.length });
    }

    return buildMarkdownBookFromSections(sections, { pageChars });
  }

  async function initBookImporter() {
    const sourceSel = document.getElementById("importSource");
    const bookControls = document.getElementById("bookControls");
    const textControls = document.getElementById("textControls");
    const bookSelect = document.getElementById("bookSelect");
    const chapterControls = document.getElementById("chapterControls");
    const chapterSelect = document.getElementById("chapterSelect");
    const pageControls = document.getElementById("pageControls");
    const pageStart = document.getElementById("pageStart");
    const pageEnd = document.getElementById("pageEnd");
    const loadBtn = document.getElementById("loadBookSelection");
    const appendBtn = document.getElementById("appendBookSelection");
    const bulkInput = document.getElementById("bulkInput");

    if (!sourceSel || !bookControls || !bookSelect || !chapterControls || !chapterSelect || !pageControls || !pageStart || !pageEnd || !loadBtn || !appendBtn || !bulkInput) {
      console.warn("Book importer: missing required elements");
      return;
    }

    let manifest = [];
    let currentBookRaw = "";
    let hasExplicitChapters = false;

    // When chapters exist, we keep chapter pages in memory
    let chapterList = []; // {title, raw}
    let currentPages = []; // [{title, text}]
    let currentChapterIndex = null;

    function setSourceUI() {
      const isBook = sourceSel.value === "book";
      bookControls.style.display = isBook ? "flex" : "none";
      if (textControls) textControls.style.display = isBook ? "none" : "block";

      // UX: "Add Pages" only makes sense for ad-hoc Text input.
      // For Books, allowing out-of-order appends adds confusion with no value.
      if (appendBtn) appendBtn.style.display = isBook ? "none" : "inline-block";
    }

    function countExplicitH1(text) {
      const lines = String(text || "").split(/\r?\n/);
      let count = 0;
      for (const line of lines) if (/^\s{0,3}#\s+/.test(line)) count++;
      return count;
    }

    function parsePagesWithTitles(raw) {
      const text = String(raw || "");
      const lines = text.split(/\r?\n/);

      const pages = [];
      let cur = null;

      function push() {
        if (!cur) return;
        const cleaned = cur.lines
          .map(l => l.trim())
          .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));

        const body = cleaned.join(" ").trim();
        if (body) pages.push({ title: cur.title, text: body });
      }

      for (const line of lines) {
        const h2 = line.match(/^\s{0,3}##\s+(.*)\s*$/);
        if (h2) {
          push();
          const title = (h2[1] || "").trim() || `Page ${pages.length + 1}`;
          cur = { title, lines: [] };
          continue;
        }
        if (!cur) cur = { title: "Page 1", lines: [] };
        cur.lines.push(line);
      }
      push();

      // Fallback: if no H2 pages were detected, try --- separators
      if (pages.length <= 1) {
        const blocks = String(raw || "").trim().split(/\n---\n/g);
        if (blocks.length > 1) {
          const out = [];
          blocks.forEach((blk, i) => {
            const cleaned = blk.split(/\r?\n/)
              .map(l => l.trim())
              .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));
            const body = cleaned.join(" ").trim();
            if (body) out.push({ title: `Page ${out.length + 1}`, text: body });
          });
          return out.length ? out : pages;
        }
      }

      
  // If the user didn't use explicit separators (--- / ## Page X), fall back to a
  // "paragraph pages" heuristic: blocks separated by one-or-more blank lines.
  // This matches typical copy/paste behavior (news articles, essays, etc.).
  const usedExplicitSeparators = /\n\s*---\s*\n/.test(raw) || /^\s*##\s*Page\s+\d+/im.test(raw);
  if (!usedExplicitSeparators) {
    const blocks = raw
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map(b => b.trim())
      .filter(Boolean);

    // If we got multiple blocks, treat each as a page.
    if (blocks.length > 1) {
      pages = blocks.map((b, i) => ({
        title: `Page ${i + 1}`,
        text: b.replace(/\s+/g, " ").trim()
      }));
    }
  }

  return pages;
    }

    function setSelectOptions(selectEl, options, placeholder) {
      selectEl.innerHTML = "";
      if (placeholder) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        selectEl.appendChild(opt);
      }
      options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = String(o.value);
        opt.textContent = o.label;
        selectEl.appendChild(opt);
      });
    }

    function populatePagesSelect(pages) {
      currentPages = pages || [];
      if (!currentPages.length) {
        setSelectOptions(pageStart, [], "No pages detected");
        setSelectOptions(pageEnd, [], "No pages detected");
        return;
      }

      const opts = currentPages.map((p, idx) => ({
        value: idx,
        label: `${idx + 1}. ${p.title || `Page ${idx + 1}`}`
      }));

      setSelectOptions(pageStart, opts, "Start page…");
      setSelectOptions(pageEnd, opts, "End page…");

      // Default to full range
      pageStart.value = "0";
      pageEnd.value = String(currentPages.length - 1);
    }

    function getCurrentChapterRaw() {
      if (hasExplicitChapters && Number.isFinite(currentChapterIndex) && chapterList[currentChapterIndex]) {
        return chapterList[currentChapterIndex].raw;
      }
      return currentBookRaw;
    }

    function refreshChapterAndPagesUI() {
      // Chapters present?
      if (!hasExplicitChapters) {
        chapterControls.style.display = "none";
        currentChapterIndex = null;
        const pages = parsePagesWithTitles(currentBookRaw);
        populatePagesSelect(pages);
        return;
      }

      chapterControls.style.display = "flex";
      const chapOpts = chapterList.map((ch, idx) => ({ value: idx, label: ch.title || `Chapter ${idx + 1}` }));
      setSelectOptions(chapterSelect, chapOpts, "Select a chapter…");
      chapterSelect.value = "0";
      currentChapterIndex = 0;

      const pages = parsePagesWithTitles(getCurrentChapterRaw());
      populatePagesSelect(pages);
    }

    async function loadManifest() {
      const candidates = [
        "assets/books/index.json",
        "index.json"
      ];

      let lastErr = null;
      for (const path of candidates) {
        try {
          const res = await fetch(path, { cache: "no-cache" });
          if (!res.ok) throw new Error(`manifest fetch failed (${res.status}) at ${path}`);
          const data = await res.json();
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);

          return;
        } catch (e) {
          lastErr = e;
        }
      }
      // Fallback for local file:// usage (fetch is often blocked). If an embedded manifest exists, use it.
      try {
        if (window.EMBED_MANIFEST && Array.isArray(window.EMBED_MANIFEST)) {
          const data = window.EMBED_MANIFEST;
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);
          return;
        }
      } catch (_) {}
      throw lastErr || new Error("manifest fetch failed");
    }

    async function loadBook(id) {
      currentBookRaw = "";
      chapterList = [];
      hasExplicitChapters = false;
      currentChapterIndex = null;

      setSelectOptions(chapterSelect, [], "Loading…");
      setSelectOptions(pageStart, [], "Loading…");
      setSelectOptions(pageEnd, [], "Loading…");

      // Local library
      if (isLocalBookId(id)) {
        try {
          const rec = await localBookGet(stripLocalPrefix(id));
          if (!rec || typeof rec.markdown !== 'string') throw new Error('local book missing');
          currentBookRaw = rec.markdown;
          hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
          if (hasExplicitChapters) chapterList = parseChaptersFromMarkdown(currentBookRaw);
          refreshChapterAndPagesUI();
          return;
        } catch (e) {
          setSelectOptions(chapterSelect, [], "Failed to load local book");
          setSelectOptions(pageStart, [], "Failed to load local book");
          setSelectOptions(pageEnd, [], "Failed to load local book");
          console.error('Local book load error:', e);
          return;
        }
      }

      const entry = manifest.find(b => b.id === id);
      if (!entry) {
        setSelectOptions(chapterSelect, [], "Select a book first");
        setSelectOptions(pageStart, [], "Select a book first");
        setSelectOptions(pageEnd, [], "Select a book first");
        return;
      }

      try {
        const res = await fetch(entry.path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`book fetch failed (${res.status}) at ${entry.path}`);
        currentBookRaw = await res.text();

        hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
        if (hasExplicitChapters) {
          chapterList = parseChaptersFromMarkdown(currentBookRaw);
        }

        refreshChapterAndPagesUI();
      } catch (e) {
        // Fallback for local file:// usage: try embedded books
        try {
          if (window.EMBED_BOOKS && typeof window.EMBED_BOOKS[id] === "string") {
            currentBookRaw = window.EMBED_BOOKS[id];
            hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
            if (hasExplicitChapters) {
              chapterList = parseChaptersFromMarkdown(currentBookRaw);
            }
            refreshChapterAndPagesUI();
            return;
          }
        } catch (_) {}

        setSelectOptions(chapterSelect, [], "Failed to load book");
        setSelectOptions(pageStart, [], "Failed to load book");
        setSelectOptions(pageEnd, [], "Failed to load book");
        console.error("Book load error:", e);
      }
    }

    function applySelectionToBulkInput(text, { append = false } = {}) {
      bulkInput.value = String(text || "").trim();
      if (append) appendPages();
      else addPages();
    }

    // Events
    sourceSel.addEventListener("change", setSourceUI);
    setSourceUI();

    bookSelect.addEventListener("change", async () => {
      const id = bookSelect.value;
      if (!id) return;
      await loadBook(id);
    });

    chapterSelect.addEventListener("change", () => {
      const idx = parseInt(chapterSelect.value || "", 10);
      if (!Number.isFinite(idx)) return;
      currentChapterIndex = idx;
      const pages = parsePagesWithTitles(getCurrentChapterRaw());
      populatePagesSelect(pages);
    });

    // Keep end >= start
    pageStart.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageEnd.value = String(s);
    });
    pageEnd.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageStart.value = String(e);
    });

    loadBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, it just loads pages from the textarea.
      if (sourceSel.value === "text") {
        addPages();
        return;
      }

      // Book mode: load selected book/page slice into the textarea, then add pages.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const slice = currentPages
        .slice(s, e + 1)
        .map((p) => p.text)
        .filter(Boolean);
      // Keep delimiter in a single JS string line (prevents accidental raw-newline parse errors)
      applySelectionToBulkInput(slice.join("\n---\n"), { append: false });
    });

    appendBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, append from textarea.
      if (sourceSel.value === "text") {
        appendPages();
        return;
      }

      // Book mode: append selected slice.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const slice = currentPages
        .slice(s, e + 1)
        .map((p) => p.text)
        .filter(Boolean);

      applySelectionToBulkInput(slice.join("\n---\n"), { append: true });
    });

    async function populateBookSelectWithLocal() {
      // Populate server + local books in one dropdown.
      bookSelect.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a book…";
      bookSelect.appendChild(placeholder);

      // Local books
      let locals = [];
      try { locals = await localBooksGetAll(); } catch (_) { locals = []; }
      if (locals.length) {
        const og = document.createElement('optgroup');
        og.label = 'Saved on this device';
        locals
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
          .forEach((b) => {
            const opt = document.createElement('option');
            opt.value = `local:${b.id}`;
            opt.textContent = b.title || 'Untitled (Local)';
            og.appendChild(opt);
          });
        bookSelect.appendChild(og);
      }

      // Server books
      if (manifest.length) {
        const og = document.createElement('optgroup');
        og.label = 'Server books';
        manifest.forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.title;
          og.appendChild(opt);
        });
        bookSelect.appendChild(og);
      }

      if (!locals.length && !manifest.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No books found';
        bookSelect.appendChild(opt);
      }
    }

    try {
      await loadManifest();
      await populateBookSelectWithLocal();
    } catch (e) {
      // Even if manifest fails, still show local library.
      manifest = [];
      await populateBookSelectWithLocal();
      console.error("Book manifest load error:", e);
    }

    // Expose a tiny hook so the import modal can refresh the dropdown after import.
    window.__rcRefreshBookSelect = async () => {
      try { await populateBookSelectWithLocal(); } catch (_) {}
    };
  }



  async function addPages() {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    // UX rule: whenever user generates new pages, start fresh (no leftover pages)
    if (pages.length > 0) resetSession({ confirm: false });

    // Split pasted text into pages using paragraph breaks (blank lines).
    // Still supports legacy delimiters (--- / "## Page X") if present.
    const newPages = splitIntoPages(input);
    for (const pageText of newPages) {
      const pageHash = await stableHashText(pageText);
      let consolidation = "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          rating = Number.isFinite(r) ? r : 0;
          isSandstone = !!rec?.isSandstone;
          aiExpanded = !!rec?.aiExpanded;
          aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          aiAt = rec?.aiAt ?? null;
          aiRating = rec?.aiRating ?? null;
        }
      } catch (_) {}

      pages.push(pageText);
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true, // Assume true until sandstoned
        isSandstone,
        rating,
        // Anchors
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    schedulePersistSession();
    render();
    checkSubmitButton();
  }

  // Append pages to the existing session (does NOT clear pages/timers/ratings).
  // Uses the same splitting rules as addPages().
  async function appendPages() {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    const newPages = splitIntoPages(input);
    for (const pageText of newPages) {
      const pageHash = await stableHashText(pageText);
      let consolidation = "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          rating = Number.isFinite(r) ? r : 0;
          isSandstone = !!rec?.isSandstone;
          aiExpanded = !!rec?.aiExpanded;
          aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          aiAt = rec?.aiAt ?? null;
          aiRating = rec?.aiRating ?? null;
        }
      } catch (_) {}

      pages.push(pageText);
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true,
        isSandstone,
        rating,
        // Anchors
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    render();
    checkSubmitButton();
  }

  function resetSession({ confirm = true, clearPersistedWork = false, clearAnchors = false } = {}) {
    if (confirm && !window.confirm("Clear loaded pages and remove your consolidations and feedback?")) return false;

    if (clearPersistedWork) {
      clearPersistedWorkForPageHashes(pageData.map(p => p?.pageHash), { clearAnchors });
    }
    pages = [];
    pageData = [];
    timers = [];
    intervals.forEach(i => clearInterval(i));
    intervals = [];
    sandSound.pause();
    document.getElementById("pages").innerHTML = "";
    document.getElementById("submitBtn").disabled = true;
    document.getElementById("verdictSection").style.display = "none";
    lastFocusedPageIndex = -1;
    evaluationPhase = false;
    clearPersistedSession();
    return true;
  }

  function render() {
    const container = document.getElementById("pages");
    container.innerHTML = "";

    pages.forEach((text, i) => {
      timers[i] ??= 0;

      const page = document.createElement("div");
      page.className = "page";
      page.dataset.pageIndex = String(i);

      page.innerHTML = `
        <div class="page-header">Page ${i + 1}</div>
        <div class="page-text">${escapeHtml(text)}</div>

        <div class="page-actions">
          <button type="button" class="top-btn tts-btn" data-tts="page" data-page="${i}">🔊 Read page</button>
        </div>

        <div class="anchors-row">
          <div class="anchors-ui anchors-ui--right">
            <div class="anchors-counter" title="Anchors">Anchors Found: 0/0</div>
            <button type="button" class="top-btn hint-btn">Hint</button>
          </div>
        </div>

        <div class="anchors-nav">
          <button class="top-btn next-btn" onclick="goToNext(${i})">▶ Next</button>
        </div>

        <div class="page-header">Consolidation</div>

        <div class="sand-wrapper">
          <textarea placeholder="What was this page really about?"></textarea>
          <div class="sand-layer"></div>
        </div>

        <div class="info-row">
          <div class="counter-section">
            <div class="timer">Timer: ${timers[i]} / ${goalTime}</div>
            <div class="char-counter">Characters: <span class="char-count">0</span> / ${goalCharCount}</div></div>

          <div class="evaluation-section">
            <div class="evaluation-label">Evaluation</div>
            <div class="stars locked" data-page="${i}">
              <span class="star" data-value="1">🧭</span>
              <span class="star" data-value="2">🧭</span>
              <span class="star" data-value="3">🧭</span>
              <span class="star" data-value="4">🧭</span>
              <span class="star" data-value="5">🧭</span>
            </div>
          </div>

          <div class="action-buttons">
            <button class="ai-btn" data-page="${i}" style="display: none;">▼ AI Evaluate&nbsp;&nbsp;</button>
          </div>
        </div>
        
        <div class="ai-feedback" data-page="${i}" style="display: none;">
          <!-- AI feedback will be inserted here -->
        </div>
      `;

      const textarea = page.querySelector("textarea");
      const sand = page.querySelector(".sand-layer");
      const timerDiv = page.querySelector(".timer");
      const wrapper = page.querySelector(".sand-wrapper");
      const charCountSpan = page.querySelector(".char-count");
      const starsDiv = page.querySelector(".evaluation-section .stars");

      // TTS: Read page text
      const ttsPageBtn = page.querySelector('.tts-btn[data-tts="page"]');
      if (ttsPageBtn) {
        ttsPageBtn.addEventListener("click", () => {
          ttsSpeakQueue(`page-${i}`, [text]);
        });
      }


      // Character tracking
      textarea.value = pageData[i].consolidation || "";
      charCountSpan.textContent = Math.min(pageData[i].charCount, goalCharCount);
      
      textarea.addEventListener("input", (e) => {
        const count = e.target.value.length;
        pageData[i].consolidation = e.target.value;
        pageData[i].charCount = count;
        charCountSpan.textContent = Math.min(count, goalCharCount);

        // Anchors: deterministic matching (UI-only; no inference).
        updateAnchorsUIForPage(page, i, e.target.value);
        
        // Check if all pages have text to unlock compasses
        checkCompassUnlock();
      });

      // Persist learner work when they leave the field (reduces churn while typing).
      textarea.addEventListener("blur", () => {
        schedulePersistSession();
      });

      // Clicking anywhere on the page should make "Next" advance from that page.
      page.addEventListener("pointerdown", () => {
        lastFocusedPageIndex = i;
      });

      // Timer events
      textarea.addEventListener("focus", () => {
        
        lastFocusedPageIndex = i;
// Scroll to show entire page card (passage + textarea) instead of centering on textarea
        const pageCard = textarea.closest('.page');
        pageCard.scrollIntoView({ 
          behavior: 'instant',
          block: 'start',
          inline: 'nearest'
        });
        
        // Page turn immersion: activate stripe if starting fresh
        if (pageData[i].charCount === 0) {
          page.classList.add('page-active');
          if (!allSoundsMuted) {
            pageTurnSound.currentTime = 0;
            pageTurnSound.play();
          }
        }

        // Anchors (lazy): first meaningful engagement triggers anchor generation for this page.
        // This avoids the huge cost of precomputing anchors for every loaded page.
        try { hydrateAnchorsIntoPageEl(page, i); } catch (_) {}

        startTimer(i, sand, timerDiv, wrapper, textarea);
      });
      
      textarea.addEventListener("blur", () => {
        // Deactivate page stripe when leaving
        page.classList.remove('page-active');
        stopTimer(i);
        checkCompassUnlock(); // Check if compasses should unlock when user leaves textarea
      });


      // Keyboard navigation (iPad + desktop)
      textarea.addEventListener("keydown", (e) => {
        // Enter: unfocus textarea (Shift+Enter remains normal newline behavior)
        // This makes iPad flow smoother: user can hit Enter to dismiss keyboard,
        // then press Enter again (global) to jump to next box or click AI.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          // Prevent the global Enter handler from running in the same event.
          // (blur changes activeElement, which would otherwise trigger goToNext).
          e.stopPropagation();
          textarea.blur();
          return;
        }

        // Esc: unfocus textarea
        if (e.key === "Escape") {
          e.preventDefault();
          textarea.blur();
        }
      });

      // Compass click handlers
      const stars = starsDiv.querySelectorAll(".star");
      stars.forEach(star => {
        star.addEventListener("click", () => {
          if (starsDiv.classList.contains("locked")) return;
          const value = parseInt(star.dataset.value);
          setRating(i, value, stars);
        });
      });
      
      // AI button click handler
      const aiBtn = page.querySelector(".ai-btn");
      if (aiBtn) {
        aiBtn.addEventListener("click", () => evaluatePageWithAI(i));
      }

      // Restore AI panel visibility + content if it was previously opened.
      // (User-facing state; persisted per pageHash.)
      const feedbackDiv = page.querySelector(`.ai-feedback[data-page="${i}"]`);
      if (aiBtn && feedbackDiv) {
        const hasFeedback = String(pageData[i]?.aiFeedbackRaw || '').trim().length > 0;
        if (hasFeedback) {
          // Ensure the button is available if there is saved feedback.
          aiBtn.style.display = 'block';
          // If the panel is expanded, show it and rebuild the formatted UI.
          if (pageData[i]?.aiExpanded) {
            feedbackDiv.style.display = 'block';
            aiBtn.textContent = '▲ AI Evaluate';
            // Rehydrate the formatted view from persisted raw feedback.
            try {
              displayAIFeedback(i, pageData[i].aiFeedbackRaw, null, feedbackDiv);
            } catch (e) {
              // Fallback: show raw text if formatted renderer fails.
              feedbackDiv.textContent = String(pageData[i].aiFeedbackRaw || '');
            }
          } else {
            feedbackDiv.style.display = 'none';
            aiBtn.textContent = '▼ AI Evaluate';
          }
        }
      }
      
      // Restore previous rating if exists
      if (pageData[i].rating > 0) {
        const evalStars = starsDiv.querySelectorAll(".star");
        evalStars.forEach((star, starIdx) => {
          if (starIdx < pageData[i].rating) {
            star.classList.add("filled");
          }
        });
        // Stop animation since this page is already rated
        starsDiv.classList.add('rated');
      }
      
      // Restore sandstone state if applicable
      if (pageData[i].isSandstone) {
        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        const evalStars = page.querySelector(".evaluation-section .stars");
        evalStars.classList.add("locked");
        evalStars.style.opacity = "0.15";
        sand.style.height = "100%";
      } else if (timers[i] > 0) {
        // Restore partial sand if timer was running
        const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
	const sandDuration = goalTime * SAND_START_PERCENTAGE;
        if (timers[i] >= sandStartTime) {
          const sandElapsed = timers[i] - sandStartTime;
          const pct = Math.min(sandElapsed / sandDuration, 1);
          sand.style.height = `${pct * 100}%`;
        }
      }

      container.appendChild(page);

      // Anchors: bind hint button.
      // IMPORTANT cost control: do NOT hydrate anchors for every page on load.
      // We generate anchors lazily on first meaningful interaction (focus / hint / evaluate).
      bindHintButton(page, i);

    });
    
    // Check states after rendering
    checkCompassUnlock();
    checkSubmitButton();
  }

  function startTimer(i, sand, timerDiv, wrapper, textarea) {
    if (intervals[i]) return;

    let sandSoundStarted = false;

    intervals[i] = setInterval(() => {
      timers[i]++;
      
      // Sand starts when configured percentage of time remains
      const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
      const sandDuration = goalTime * SAND_START_PERCENTAGE;
      
      if (timers[i] >= sandStartTime) {
        // Start sand sound when sand starts (if not muted)
        if (!sandSoundStarted) {
          sandSound.currentTime = 0;
          if (!allSoundsMuted) {
            if (window.playSfx) window.playSfx(sandSound, { restart: true, loop: true, retries: 3, delay: 120 });
            else sandSound.play();
          }
          sandSoundStarted = true;
        }
        
        const sandElapsed = timers[i] - sandStartTime;
        const pct = Math.min(sandElapsed / sandDuration, 1);
        sand.style.height = `${pct * 100}%`;
      }
      
      timerDiv.textContent = `Timer: ${timers[i]} / ${goalTime}`;

      if (timers[i] >= goalTime) {
        clearInterval(intervals[i]);
        intervals[i] = null;

        sandSound.pause();
        if (!allSoundsMuted) {
          stoneSound.currentTime = 0;
          if (window.playSfx) window.playSfx(stoneSound, { restart: true, loop: false, retries: 4, delay: 160 });
          else stoneSound.play();
        }

        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        textarea.blur();
        
        // Mark page as sandstoned and failed timing
        pageData[i].isSandstone = true;
        pageData[i].completedOnTime = false;
        pageData[i].editedAt = Date.now();
        
        // Block compasses on this page permanently
        const starsDiv = wrapper.closest(".page").querySelector(".evaluation-section .stars");
        starsDiv.classList.add("locked");
        starsDiv.style.opacity = "0.15";
        
        checkSubmitButton();
        schedulePersistSession();
      }
    }, 1000);
  }

  function stopTimer(i) {
    clearInterval(intervals[i]);
    intervals[i] = null;
    sandSound.pause();
  }

    /**
   * Clear Session (single reset button)
   * - Clears user-facing state: loaded pages + learner work.
   * - Keeps anchors (anchors are version-gated and backend-owned).
   */
  // Single user-facing reset: clears the currently loaded pages and any work tied to them.
  // Keeps anchors (they are version-gated and backend-owned).
  function clearPages() {
    const ok = resetSession({ confirm: true, clearPersistedWork: true, clearAnchors: false });
    if (ok) {
      // Belt-and-suspenders: ensure any pending debounced save can't resurrect state.
      try { persistSessionNow(); } catch (_) {}
      render();
      try { updateDiagnostics(); } catch (_) {}
    }
  }

  // Back-compat alias (older HTML/button wiring)
  function clearSession() { return clearPages(); }

// ===================================

  // 🗂️ Manage Library UI
  // ===================================

  (function initManageLibraryModal() {
    const openBtn = document.getElementById('manageLibraryBtn');
    const modal = document.getElementById('manageLibraryModal');
    const closeBtn = document.getElementById('manageLibraryClose');
    const listEl = document.getElementById('manageLibraryList');
    if (!openBtn || !modal || !listEl) return;

    function show() {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      render();
    }
    function hide() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    async function render() {
      listEl.innerHTML = '';
      let books = [];
      try { books = await localBooksGetAll(); } catch (_) { books = []; }
      if (!books.length) {
        const empty = document.createElement('div');
        empty.className = 'import-status';
        empty.textContent = 'No local books yet. Use “Import EPUB” to add one.';
        listEl.appendChild(empty);
        return;
      }

      books
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .forEach((b) => {
          const row = document.createElement('div');
          row.className = 'library-row';

          const left = document.createElement('div');
          const t = document.createElement('div');
          t.className = 'library-row-title';
          t.textContent = b.title || 'Untitled';
          const m = document.createElement('div');
          m.className = 'library-row-meta';
          const kb = Math.round((b.byteSize || 0) / 1024);
          const pages = (String(b.markdown || '').match(/^\s*##\s+/gm) || []).length;
          m.textContent = `${pages} pages • ~${kb} KB • ${new Date(b.createdAt || Date.now()).toLocaleDateString()}`;
          left.appendChild(t);
          left.appendChild(m);

          const actions = document.createElement('div');
          actions.className = 'library-row-actions';
          const del = document.createElement('button');
          del.className = 'btn-danger';
          del.type = 'button';
          del.textContent = 'Delete';
          del.addEventListener('click', async () => {
            const ok = confirm(`Delete “${b.title || 'this book'}” from this device?`);
            if (!ok) return;
            try {
              await localBookDelete(b.id);
              try { if (typeof window.__rcRefreshBookSelect === 'function') await window.__rcRefreshBookSelect(); } catch (_) {}
              render();
            } catch (e) {
              alert('Delete failed.');
            }
          });
          actions.appendChild(del);

          row.appendChild(left);
          row.appendChild(actions);
          listEl.appendChild(row);
        });
    }

    openBtn.addEventListener('click', show);
    closeBtn?.addEventListener('click', hide);
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
  })();

  // ===================================
