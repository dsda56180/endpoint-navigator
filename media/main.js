(function () {
  const vscode = acquireVsCodeApi();

  const tabsEl = document.getElementById('tabs');
  const inputEl = document.getElementById('q');
  const reEl = document.getElementById('re');
  const caseEl = document.getElementById('case');
  const countEl = document.getElementById('count');
  const errorEl = document.getElementById('error');
  const listEl = document.getElementById('list');

  let state = {
    kind: null,
    regex: false,
    caseSensitive: false,
    query: '',
    items: [],
    selected: 0,
    stats: [],
    total: 0
  };

  let timer = null;

  function sendSearch(immediate) {
    if (timer) {
      clearTimeout(timer);
    }
    const run = function () {
      vscode.postMessage({
        type: 'search',
        query: inputEl.value,
        kind: state.kind,
        regex: state.regex,
        caseSensitive: state.caseSensitive
      });
    };
    if (immediate) {
      run();
    } else {
      timer = setTimeout(run, 60);
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'tab' + (state.kind === null ? ' active' : '');
    all.textContent = 'ALL';
    const allCount = document.createElement('span');
    allCount.className = 'count';
    allCount.textContent = String(state.stats.reduce(function (s, t) { return s + t.count; }, 0));
    all.appendChild(allCount);
    all.addEventListener('click', function () {
      state.kind = null;
      renderTabs();
      sendSearch(true);
    });
    tabsEl.appendChild(all);

    state.stats.forEach(function (tab) {
      const btn = document.createElement('button');
      btn.className = 'tab' + (state.kind === tab.kind ? ' active' : '');
      btn.textContent = tab.label;
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = String(tab.count);
      btn.appendChild(c);
      btn.addEventListener('click', function () {
        state.kind = tab.kind;
        renderTabs();
        sendSearch(true);
      });
      tabsEl.appendChild(btn);
    });
  }

  function badgeText(item) {
    if (item.kind === 'rest') {
      return item.httpMethod && item.httpMethod !== 'ALL' ? item.httpMethod : 'REST';
    }
    return item.kindLabel;
  }

  function renderList() {
    listEl.innerHTML = '';
    countEl.textContent = state.total > state.items.length
      ? state.items.length + '/' + state.total
      : String(state.total);

    if (state.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.query ? '没有匹配的接口' : '输入路径、中文描述或类名开始搜索';
      listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    state.items.forEach(function (item, idx) {
      const row = document.createElement('div');
      row.className = 'row' + (idx === state.selected ? ' selected' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', idx === state.selected ? 'true' : 'false');

      const badge = document.createElement('span');
      badge.className = 'badge ' + item.kind;
      badge.textContent = badgeText(item);
      row.appendChild(badge);

      const main = document.createElement('div');
      main.className = 'main';

      const title = document.createElement('div');
      title.className = 'title';
      if (item.kind === 'rest' && item.httpMethod) {
        const m = document.createElement('span');
        m.className = 'method';
        m.textContent = item.httpMethod;
        title.appendChild(m);
      }
      const pathText = document.createElement('span');
      pathText.textContent = item.path || item.name;
      title.appendChild(pathText);
      if (item.unresolved && item.unresolved.length > 0) {
        const u = document.createElement('span');
        u.className = 'unresolved';
        u.textContent = '  ⚠ ' + item.unresolved.join(', ');
        title.appendChild(u);
      }
      main.appendChild(title);

      const desc = document.createElement('div');
      desc.className = 'desc';
      const bits = [];
      if (item.description) {
        bits.push(item.description);
      }
      if (item.className) {
        bits.push(item.className + (item.methodName ? '.' + item.methodName : ''));
      }
      desc.textContent = bits.join('  ·  ');
      main.appendChild(desc);

      row.appendChild(main);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const fileName = item.filePath.split(/[\\/]/).pop() || '';
      meta.textContent = (item.module ? item.module + ' · ' : '') + fileName + ':' + item.line;
      row.appendChild(meta);

      row.addEventListener('click', function () {
        vscode.postMessage({ type: 'open', id: item.id });
      });
      row.addEventListener('mousemove', function () {
        if (state.selected !== idx) {
          state.selected = idx;
          highlight();
        }
      });

      frag.appendChild(row);
    });

    listEl.appendChild(frag);
  }

  function highlight() {
    const rows = listEl.querySelectorAll('.row');
    rows.forEach(function (row, idx) {
      if (idx === state.selected) {
        row.classList.add('selected');
        row.setAttribute('aria-selected', 'true');
        if (row.offsetTop < listEl.scrollTop) {
          listEl.scrollTop = row.offsetTop;
        } else if (row.offsetTop + row.offsetHeight > listEl.scrollTop + listEl.clientHeight) {
          listEl.scrollTop = row.offsetTop + row.offsetHeight - listEl.clientHeight;
        }
      } else {
        row.classList.remove('selected');
        row.setAttribute('aria-selected', 'false');
      }
    });
  }

  function move(delta) {
    if (state.items.length === 0) {
      return;
    }
    const next = state.selected + delta;
    if (next < 0 || next >= state.items.length) {
      return;
    }
    state.selected = next;
    highlight();
  }

  function openSelected() {
    const item = state.items[state.selected];
    if (item) {
      vscode.postMessage({ type: 'open', id: item.id });
    }
  }

  inputEl.addEventListener('input', function () {
    state.query = inputEl.value.trim();
    state.selected = 0;
    sendSearch(false);
  });

  reEl.addEventListener('click', function () {
    state.regex = !state.regex;
    reEl.classList.toggle('on', state.regex);
    sendSearch(true);
  });

  caseEl.addEventListener('click', function () {
    state.caseSensitive = !state.caseSensitive;
    caseEl.classList.toggle('on', state.caseSensitive);
    sendSearch(true);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputEl.value.length > 0) {
        inputEl.value = '';
        state.query = '';
        state.selected = 0;
        sendSearch(true);
      } else {
        vscode.postMessage({ type: 'close' });
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (document.activeElement === inputEl) {
        const active = tabsEl.querySelector('.tab.active');
        if (active) {
          active.focus();
        }
      } else {
        inputEl.focus();
      }
    }
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;

    if (msg.type === 'stats') {
      state.stats = msg.stats || [];
      renderTabs();
      return;
    }

    if (msg.type === 'results') {
      state.items = msg.items || [];
      state.total = msg.total || 0;
      if (state.selected >= state.items.length) {
        state.selected = 0;
      }
      errorEl.classList.remove('show');
      renderList();
      return;
    }

    if (msg.type === 'error') {
      errorEl.textContent = msg.message;
      errorEl.classList.add('show');
      state.items = [];
      state.total = 0;
      renderList();
      return;
    }

    if (msg.type === 'initial') {
      if (msg.query) {
        inputEl.value = msg.query;
        state.query = msg.query;
        sendSearch(true);
      }
      inputEl.focus();
      return;
    }

    if (msg.type === 'focusSearch') {
      inputEl.focus();
      inputEl.select();
    }
  });

  renderTabs();
  renderList();
  vscode.postMessage({ type: 'ready' });
})();
