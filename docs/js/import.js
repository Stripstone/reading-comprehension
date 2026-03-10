// Split from original app.js during role-based phase-1 restructure.
// File: import.js
// Note: This is still global-script architecture (no bundler/modules required).

  // 📚 BOOK IMPORT (manifest-based)
  // ===================================
  // Notes:
  // - Static hosts cannot list directories. We rely on a manifest at: assets/books/index.json
  // - Loading a selection fills #bulkInput, then calls addPages() (existing behavior preserved).

  function titleFromBookId(id) {
    if (!id) return "";
    let t = String(id);
    t = t.replace(/^BOOK[_-]*/i, "");
    t = t.replace(/[_-]+/g, " ");
    t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
    return t.trim().replace(/\s+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function splitIntoPages(raw) {
    // Primary UX: users paste normal text (paragraphs separated by blank lines).
    // We also support legacy delimiters (---, "## Page X") without requiring them.
    let input = String(raw || "");
    input = input.replace(/\r\n?/g, "\n").trim();
    if (!input) return [];

    // Normalize "## Page X" into a hard delimiter
    input = input.replace(/^\s*##\s*Page\s+\d+.*$/gim, "\n\n---\n\n");

    // Split on explicit hard delimiters first.
    const hardChunks = input.split(/\n\s*---\s*\n/g);

    // Paragraph splitting (blank lines) + fallback for single-newline paragraphs.
    const out = [];

    const startsNewParagraph = (prevLine, nextLine) => {
      if (!prevLine || !nextLine) return false;
      const prevEndsSentence = /[.!?\"”']\s*$/.test(prevLine.trim());
      const nextStartsPara = /^[A-Z0-9“"'\(\[]/.test(nextLine.trim());
      return prevEndsSentence && nextStartsPara;
    };

    for (const hc of hardChunks) {
      const chunk = String(hc || "").trim();
      if (!chunk) continue;

      // 1) Normal: blank-line-separated paragraphs.
      let paras = chunk.split(/\n\s*\n+/g).map(s => s.trim()).filter(Boolean);

      // 2) Fallback: single newlines between paragraphs (common when copying from web).
      if (paras.length <= 1 && /\n/.test(chunk)) {
        const lines = chunk.split(/\n+/).map(l => l.trimEnd());
        const tmp = [];
        let buf = [];
        for (let i = 0; i < lines.length; i++) {
          const line = (lines[i] || "").trim();
          if (!line) continue;
          if (/^[#—]/.test(line)) continue;
          buf.push(line);
          const next = (lines[i + 1] || "").trim();
          if (startsNewParagraph(line, next)) {
            tmp.push(buf.join(" ").replace(/\s+/g, " ").trim());
            buf = [];
          }
        }
        if (buf.length) tmp.push(buf.join(" ").replace(/\s+/g, " ").trim());
        if (tmp.length > 1) paras = tmp;
      }

      for (const p of paras) {
        const cleaned = p
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !/^[#—]/.test(l))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned) out.push(cleaned);
      }
    }

    return out;
  }

  function parseChaptersFromMarkdown(raw) {
    const text = String(raw || "");
    const lines = text.split(/\r?\n/);

    const chapters = [];
    let current = null;

    function pushCurrent() {
      if (!current) return;
      const rawText = current.rawLines.join("\n").trim();
      if (rawText) chapters.push({ title: current.title, raw: rawText });
    }

    for (const line of lines) {
      // H1 headings define chapters
      const h1 = line.match(/^\s{0,3}#\s+(.*)\s*$/);
      if (h1) {
        pushCurrent();
        const title = (h1[1] || "").trim() || `Chapter ${chapters.length + 1}`;
        current = { title, rawLines: [] };
        continue;
      }

      // Everything else belongs to the current chapter (or implicit intro)
      if (!current) current = { title: "Introduction", rawLines: [] };
      current.rawLines.push(line);
    }

    pushCurrent();
    return chapters;
  }

  // ===================================

  // ➕ Import EPUB UI (local-first)
  // ===================================

  (function initEpubImportModal() {
    const openBtn = document.getElementById('importBookBtn');
    const modal = document.getElementById('importBookModal');
    const closeBtn = document.getElementById('importBookClose');

    const dropzone = document.getElementById('importDropzone');
    const browseBtn = document.getElementById('importBrowseBtn');
    const fileInput = document.getElementById('importFileInput');
    const scanBtn = document.getElementById('importScanBtn');
    const uploadStatus = document.getElementById('importUploadStatus');

    const stageUpload = document.getElementById('importStageUpload');
    const stagePick = document.getElementById('importStagePick');
    const stageProgress = document.getElementById('importStageProgress');

    const tocList = document.getElementById('importTocList');
    const filterInput = document.getElementById('importFilter');
    const selectAllBtn = document.getElementById('importSelectAll');
    const selectNoneBtn = document.getElementById('importSelectNone');
    const selectMainBtn = document.getElementById('importSelectMain');
    const selectionMeta = document.getElementById('importSelectionMeta');
    const advancedToggleBtn = document.getElementById('importAdvancedToggle');
    const advancedPanel = document.getElementById('importAdvancedPanel');
    const doImportBtn = document.getElementById('importDoImport');
    const backBtn = document.getElementById('importBackBtn');

    const pageSizeSel = document.getElementById('importPageSize');
    const keepParasChk = document.getElementById('importKeepParagraphs');
    const cleanupHeadingsChk = document.getElementById('importCleanupHeadings');

    const previewTitle = document.getElementById('importPreviewTitle');
    const previewBody = document.getElementById('importPreviewBody');

    const progMeta = document.getElementById('importProgressMeta');
    const progFill = document.getElementById('importProgressFill');
    const progDetail = document.getElementById('importProgressDetail');
    const doneBtn = document.getElementById('importDoneBtn');

    if (!openBtn || !modal) return;

    let _file = null;
    let _zip = null;
    let _tocItems = []; // {id,title,href,selected,tags,type,preview}
    let _activeId = null;
    let _spineHrefs = [];

    let _advancedMode = false;

    function setAdvancedMode(on) {
      _advancedMode = !!on;
      if (advancedPanel) advancedPanel.style.display = _advancedMode ? 'block' : 'none';
      if (tocList) tocList.style.display = _advancedMode ? 'none' : 'block';
      if (filterInput) filterInput.style.display = _advancedMode ? 'none' : 'block';

      // Hide selection tools when in advanced mode to avoid cramped layout.
      const tools = document.querySelector('.import-picker-tools');
      if (tools) tools.style.display = _advancedMode ? 'none' : '';

      if (advancedToggleBtn) advancedToggleBtn.textContent = _advancedMode ? 'Contents' : 'Advanced';
    }

    function showModal() {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      // reset view
      showStage('upload');
      setAdvancedMode(false);
    }

    function hideModal() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function showStage(which) {
      if (stageUpload) stageUpload.style.display = (which === 'upload') ? 'block' : 'none';
      if (stagePick) stagePick.style.display = (which === 'pick') ? 'block' : 'none';
      if (stageProgress) stageProgress.style.display = (which === 'progress') ? 'block' : 'none';
      if (which === 'pick') setAdvancedMode(false);
    }

    function setStatus(msg) {
      if (!uploadStatus) return;
      uploadStatus.style.display = msg ? 'block' : 'none';
      uploadStatus.textContent = msg || '';
    }

    function setProgress(pct, meta, detail) {
      if (progFill) progFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      if (progMeta) progMeta.textContent = meta || '';
      if (progDetail) progDetail.textContent = detail || '';
    }

    function escapeHtmlLite(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateSelectionMeta() {
      if (!selectionMeta) return;
      const n = _tocItems.filter(x => x.selected).length;
      const total = _tocItems.length;
      selectionMeta.textContent = `Selected: ${n}/${total}`;
      if (doImportBtn) doImportBtn.disabled = n === 0;
    }

    function renderToc() {
      if (!tocList) return;
      const q = String(filterInput?.value || '').trim().toLowerCase();
      tocList.innerHTML = '';
      const frag = document.createDocumentFragment();
      _tocItems.forEach((it) => {
        if (q && !String(it.title || '').toLowerCase().includes(q)) return;
        const row = document.createElement('div');
        row.className = 'toc-row' + (it.id === _activeId ? ' is-active' : '');
        row.dataset.id = it.id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!it.selected;
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
          it.selected = cb.checked;
          updateSelectionMeta();
        });

        const body = document.createElement('div');
        const t = document.createElement('div');
        t.className = 'toc-title';
        t.textContent = it.title || 'Untitled';

        const meta = document.createElement('div');
        meta.className = 'toc-meta';
        meta.textContent = it.type === 'chapter' ? 'Chapter' : (it.type || 'Section');

        const pills = document.createElement('div');
        pills.className = 'toc-pills';
        (it.tags || []).forEach((p) => {
          const pill = document.createElement('span');
          pill.className = 'toc-pill';
          pill.textContent = p;
          pills.appendChild(pill);
        });

        body.appendChild(t);
        body.appendChild(meta);
        if (pills.childNodes.length) body.appendChild(pills);

        row.appendChild(cb);
        row.appendChild(body);

        row.addEventListener('click', async () => {
          _activeId = it.id;
          renderToc();
          if (previewTitle) previewTitle.textContent = it.title || 'Untitled';
          if (previewBody) previewBody.textContent = 'Loading preview…';
          try {
            // Preview the whole section range (from this TOC href until next TOC href in spine order)
            const spine = Array.isArray(_spineHrefs) ? _spineHrefs : [];
            const hrefToIndex = new Map(spine.map((h, idx) => [_normEpubHref(h), idx]));
            const start = hrefToIndex.get(_normEpubHref(it.href));
            let end = spine.length;
            for (let j = it._order + 1; j < _tocItems.length; j++) {
              const nxt = _tocItems[j];
              const ni = hrefToIndex.get(_normEpubHref(nxt.href));
              if (typeof ni === 'number' && typeof start === 'number' && ni > start) { end = ni; break; }
            }
            const blocks = [];
            if (typeof start === 'number') {
              for (let s = start; s < end; s++) {
                const html = await zipReadText(_zip, spine[s]);
                const cleanupHeadings = !!cleanupHeadingsChk?.checked;
                extractTextBlocksFromHtml(html)
                  .map(fixLeadingDropCapSpacing)
                  .filter(b => b && (!cleanupHeadings || !isDecorativeSpacedHeading(b)))
                  .forEach(b => blocks.push(b));
              }
            }
            const sample = (blocks || []).slice(0, 10).join('\n\n');
            if (previewBody) previewBody.textContent = sample || '(No preview available)';
          } catch (e) {
            if (previewBody) previewBody.textContent = '(Preview failed to load)';
          }
        });

        frag.appendChild(row);
      });
      tocList.appendChild(frag);
    }

    async function onFileSelected(file) {
      _file = file || null;
      _zip = null;
      _tocItems = [];
      _activeId = null;
      if (!scanBtn) return;
      if (!_file) {
        scanBtn.disabled = true;
        setStatus('');
        return;
      }
      scanBtn.disabled = false;
      setStatus(`Selected: ${_file.name} (${Math.round((_file.size || 0) / 1024)} KB)`);
    }

    async function scanContents() {
      if (!_file) return;
      if (!window.JSZip) {
        setStatus('JSZip failed to load. Check your network connection.');
        return;
      }

      try {
        scanBtn.disabled = true;
        setStatus('Reading EPUB…');
        const buf = await _file.arrayBuffer();
        _zip = await JSZip.loadAsync(buf);
        const opfPath = await epubFindOpfPath(_zip);
        if (!opfPath) throw new Error('OPF not found');
        const { metadata, items, spineHrefs } = await epubParseToc(_zip, opfPath);
        _spineHrefs = Array.isArray(spineHrefs) ? spineHrefs : [];
        const baseTitle = (metadata?.title || _file.name.replace(/\.epub$/i, '')).trim();

        // Build toc list with ids
        _tocItems = (items || []).map((it, idx) => {
          const t = (it.title || `Section ${idx + 1}`).trim();

          // Drop obvious junk: TOC titles that are actually full paragraphs.
          const words = t.split(/\s+/).filter(Boolean);
          const looksLikeParagraph = (t.length > 120) || (t.length > 80 && words.length > 14) || (words.length > 24);
          if (looksLikeParagraph) return null;

          const cls = classifySection(t);
          return {
            id: `${idx}:${t}`,
            title: t,
            href: it.href,
            _order: idx,
            type: cls.type,
            tags: cls.tags,
            selected: defaultSelectedForTitle(t)
          };
        }).filter(Boolean);

        // De-dupe obvious junk: empty titles, duplicates by href
        const seenHref = new Set();
        _tocItems = _tocItems.filter((x) => {
          if (!x.title || x.title.length < 2) return false;
          if (!x.href) return false;
          if (seenHref.has(x.href)) return false;
          seenHref.add(x.href);
          return true;
        });

        // Ensure stable order field after filtering
        _tocItems.forEach((x, i) => { x._order = i; });

        // Default preview
        if (previewTitle) previewTitle.textContent = baseTitle;
        if (previewBody) previewBody.textContent = 'Select a section on the left to preview it.';

        updateSelectionMeta();
        renderToc();
        showStage('pick');
      } catch (e) {
        console.error('EPUB scan error:', e);
        setStatus('Failed to scan EPUB. Try another file.');
      } finally {
        scanBtn.disabled = !_file;
      }
    }

    async function doImportSelected() {
      if (!_file || !_zip) return;
      const selectedIds = new Set(_tocItems.filter(x => x.selected).map(x => x.id));
      if (selectedIds.size === 0) return;

      try {
        showStage('progress');
        doneBtn.style.display = 'none';
        setProgress(0, 'Preparing', '');

        const buf = await _file.arrayBuffer();
        const bookHash = await hashArrayBufferSha256(buf);

        // Create a stable record id per file hash
        const id = bookHash;
        const title = _file.name.replace(/\.epub$/i, '').trim();

        const total = selectedIds.size;
        let createdPages = 0;

        // Build markdown
        const pageChars = parseInt(pageSizeSel?.value || '1600', 10) || 1600;
        // keepParasChk is currently informational; paragraph preservation is the default behavior.
        const cleanupHeadings = !!cleanupHeadingsChk?.checked;

        const md = await epubToMarkdownFromSelected(
          _zip,
          _tocItems,
          selectedIds,
          _spineHrefs,
          {
            pageChars,
            cleanupHeadings,
            onProgress: ({ done, total }) => {
              const pct = total ? Math.round((done / total) * 80) : 0;
              setProgress(pct, `Extracting sections (${done}/${total})`, `${createdPages} pages created`);
            }
          }
        );

        // Estimate page count by counting H2
        createdPages = (md.match(/^\s*##\s+/gm) || []).length;
        setProgress(92, 'Saving to device', `${createdPages} pages created`);

        const record = {
          id,
          title,
          createdAt: Date.now(),
          sourceName: _file.name,
          byteSize: _file.size || 0,
          markdown: md
        };
        await localBookPut(record);

        setProgress(100, 'Import complete', `${createdPages} pages created`);
        doneBtn.style.display = 'inline-block';

        // Refresh book dropdown
        try { if (typeof window.__rcRefreshBookSelect === 'function') await window.__rcRefreshBookSelect(); } catch (_) {}
      } catch (e) {
        console.error('EPUB import error:', e);
        setProgress(100, 'Import failed', 'Try again with a different file.');
        doneBtn.style.display = 'inline-block';
      }
    }

    function setAllSelected(v) {
      _tocItems.forEach((it) => (it.selected = !!v));
      updateSelectionMeta();
      renderToc();
    }

    function selectMain() {
      _tocItems.forEach((it) => {
        it.selected = (it.type === 'chapter' || it.type === 'intro');
      });
      updateSelectionMeta();
      renderToc();
    }

    // Open/close
    openBtn.addEventListener('click', showModal);
    closeBtn?.addEventListener('click', hideModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });

    // Upload
    // Keep behavior consistent: desktop supports click-to-browse + drag/drop.
    // Mobile/tablet: click-to-browse should open the file picker reliably.
    browseBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput?.click();
    });
    dropzone?.addEventListener('click', (e) => {
      // If the click was on a button (Browse), don't double-trigger.
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (btn) return;
      fileInput?.click();
    });
    dropzone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput?.click();
    });
    fileInput?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      onFileSelected(f);
    });

    // Drag/drop
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach((ev) => {
      dropzone?.addEventListener(ev, prevent);
    });
    dropzone?.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files && e.dataTransfer.files[0];
      if (f) onFileSelected(f);
    });

    scanBtn?.addEventListener('click', scanContents);
    backBtn?.addEventListener('click', () => showStage('upload'));
    filterInput?.addEventListener('input', renderToc);
    selectAllBtn?.addEventListener('click', () => setAllSelected(true));
    selectNoneBtn?.addEventListener('click', () => setAllSelected(false));
    selectMainBtn?.addEventListener('click', selectMain);
    advancedToggleBtn?.addEventListener('click', () => setAdvancedMode(!_advancedMode));
    doImportBtn?.addEventListener('click', doImportSelected);
    doneBtn?.addEventListener('click', hideModal);
  })();

  // ===================================
