(function () {
  'use strict';

  const OWNER = 'FamNomura';
  const REPO = 'RecipeBook';
  const BRANCH = 'main';
  const TOKEN_KEY = 'recipe_admin_gh_token';

  let currentToken = localStorage.getItem(TOKEN_KEY) || '';
  let recipesList = [];
  let currentFileSha = null;
  let attachedImageBase64 = null;

  // DOM Elements
  const authAccordion = document.getElementById('auth-accordion');
  const authSummaryBadge = document.getElementById('auth-summary-badge');
  const tokenInput = document.getElementById('gh-token-input');
  const saveTokenBtn = document.getElementById('save-token-btn');
  const clearTokenBtn = document.getElementById('clear-token-btn');
  const authStatus = document.getElementById('auth-status');

  const operationBar = document.getElementById('operation-bar');
  const recipeSelect = document.getElementById('recipe-select');
  const newRecipeBtn = document.getElementById('new-recipe-btn');
  const reloadListBtn = document.getElementById('reload-list-btn');

  const editorSection = document.getElementById('editor-section');
  const recipeForm = document.getElementById('recipe-form');
  const formModeTitle = document.getElementById('form-mode-title');
  const viewPageBtn = document.getElementById('view-page-btn');
  const deleteRecipeBtn = document.getElementById('delete-recipe-btn');

  const slugInput = document.getElementById('recipe-slug');
  const titleInput = document.getElementById('recipe-title');
  const servingsInput = document.getElementById('recipe-servings');
  const genreInput = document.getElementById('recipe-genre');
  const sourceInput = document.getElementById('recipe-source');
  const descInput = document.getElementById('recipe-desc');
  const imageInput = document.getElementById('recipe-image');
  const imagePreview = document.getElementById('image-preview');

  const groupsContainer = document.getElementById('ingredient-groups-container');
  const addGroupBtn = document.getElementById('add-group-btn');
  const stepsContainer = document.getElementById('steps-container-inputs');
  const addStepBtn = document.getElementById('add-step-btn');
  const submitBtn = document.getElementById('submit-btn');

  // ── GitHub API 通信 ──
  async function ghApi(path, options = {}) {
    const cleanPath = path ? path.replace(/^\/+|\/+$/g, '') : '';
    const url = cleanPath
      ? `https://api.github.com/repos/${OWNER}/${REPO}/${cleanPath}`
      : `https://api.github.com/repos/${OWNER}/${REPO}`;

    const sanitizedToken = currentToken.replace(/[^\x21-\x7E]/g, '');

    const headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${sanitizedToken}`,
      ...options.headers
    };

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(`HTTP ${res.status}: ${errData.message || res.statusText}`);
    }
    return res.status !== 204 ? res.json() : true;
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToUtf8(str) {
    const bin = atob(str.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ── 認証管理 ──
  async function verifyAndInitToken(token) {
    if (window.location.protocol === 'file:') {
      authStatus.innerHTML = '⚠️ <strong>ローカルファイル（file://）から開かれています。</strong><br><code>https://famnomura.github.io/RecipeBook/admin.html</code> を開いてください。';
      authStatus.className = 'status-badge error';
      return;
    }

    const clean = (token || '').replace(/[^\x21-\x7E]/g, '');
    if (!clean) {
      authStatus.textContent = 'トークンを入力してください。';
      authStatus.className = 'status-badge error';
      authSummaryBadge.textContent = '未認証';
      authSummaryBadge.className = 'badge';
      clearTokenBtn.style.display = 'none';
      operationBar.style.display = 'none';
      editorSection.style.display = 'none';
      return;
    }

    currentToken = clean;
    authStatus.textContent = 'GitHubに接続中...';
    authStatus.className = 'status-badge';

    try {
      await ghApi('contents/recipes');
      localStorage.setItem(TOKEN_KEY, currentToken);
      tokenInput.value = '••••••••••••••••••••';
      tokenInput.disabled = true;
      saveTokenBtn.style.display = 'none';
      clearTokenBtn.style.display = 'inline-block';
      authStatus.textContent = '✓ 接続成功: 編集権限を確認しました';
      authStatus.className = 'status-badge success';

      // アコーディオンを自動で折りたたむ
      authSummaryBadge.textContent = '✓ 接続済み';
      authSummaryBadge.className = 'badge success';
      authAccordion.open = false;

      operationBar.style.display = 'block';
      loadRecipeList();
    } catch (e) {
      let msg = e.message;
      if (msg === 'Failed to fetch') {
        msg = '通信が遮断されました。広告ブロック機能をOFFにしてお試しください。';
      }
      authStatus.textContent = `❌ 接続失敗: ${msg}`;
      authStatus.className = 'status-badge error';
      authSummaryBadge.textContent = '接続失敗';
      authSummaryBadge.className = 'badge';
      tokenInput.disabled = false;
      saveTokenBtn.style.display = 'inline-block';
      clearTokenBtn.style.display = 'none';
      authAccordion.open = true;
    }
  }

  saveTokenBtn.addEventListener('click', () => verifyAndInitToken(tokenInput.value));
  clearTokenBtn.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    currentToken = '';
    tokenInput.value = '';
    tokenInput.disabled = false;
    saveTokenBtn.style.display = 'inline-block';
    clearTokenBtn.style.display = 'none';
    authStatus.textContent = 'ログアウトしました。';
    authStatus.className = 'status-badge';
    authSummaryBadge.textContent = '未認証';
    authSummaryBadge.className = 'badge';
    authAccordion.open = true;
    operationBar.style.display = 'none';
    editorSection.style.display = 'none';
  });

  // ── 日本語タイトル付きレシピ一覧取得 ──
  async function loadRecipeList() {
    recipeSelect.innerHTML = '<option value="">-- レシピ一覧を読み込み中... --</option>';

    // 1. 公開済みの recipes.json または index.html からタイトル辞書を作成
    let titleMap = {};
    try {
      const res = await fetch(`recipes.json?t=${Date.now()}`);
      if (res.ok) {
        const list = await res.json();
        list.forEach(r => { titleMap[r.slug] = r.title; });
      }
    } catch (_) {}

    // 2. GitHub API で最新のファイル一覧を取得
    try {
      const contents = await ghApi('contents/recipes');
      recipesList = contents.filter(item => item.type === 'file' && item.name.endsWith('.md'));
      recipeSelect.innerHTML = '<option value="">-- 編集するレシピを選択 --</option>';

      recipesList.forEach(file => {
        const slug = file.name.replace(/\.md$/, '');
        const title = titleMap[slug] || slug;
        const opt = document.createElement('option');
        opt.value = slug;
        opt.textContent = title !== slug ? `${title} (${slug})` : slug;
        recipeSelect.appendChild(opt);
      });
    } catch (e) {
      recipeSelect.innerHTML = '<option value="">一覧取得エラー</option>';
      alert(`レシピ一覧の取得に失敗しました: ${e.message}`);
    }
  }

  reloadListBtn.addEventListener('click', loadRecipeList);

  // ── 材料グループ & 材料行のUI生成 ──
  function addIngredientGroup(groupName = '') {
    const card = document.createElement('div');
    card.className = 'ingredient-group-card';
    card.innerHTML = `
      <div class="group-header">
        <input type="text" class="group-title-input" placeholder="グループ名（例: 具材、合わせ調味料、ソース ※空欄でも可）" value="${escapeHtml(groupName)}">
        <button type="button" class="btn btn-secondary btn-sm add-row-to-group-btn">＋ 材料を追加</button>
        <button type="button" class="btn btn-danger btn-sm remove-group-btn" title="グループごと削除">✕ 削除</button>
      </div>
      <div class="group-items-container"></div>
    `;

    const itemsContainer = card.querySelector('.group-items-container');
    const addRowBtn = card.querySelector('.add-row-to-group-btn');
    const removeGroupBtn = card.querySelector('.remove-group-btn');

    addRowBtn.addEventListener('click', () => addIngredientRow(itemsContainer));
    removeGroupBtn.addEventListener('click', () => {
      if (groupsContainer.children.length > 1) {
        card.remove();
      } else {
        card.querySelector('.group-title-input').value = '';
        itemsContainer.innerHTML = '';
        addIngredientRow(itemsContainer);
      }
    });

    groupsContainer.appendChild(card);
    return itemsContainer;
  }

  function addIngredientRow(targetContainer, name = '', qty = '') {
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <input type="text" class="ing-name" placeholder="材料名（例: 鶏もも肉）" value="${escapeHtml(name)}" required style="flex:2;">
      <input type="text" class="ing-qty" placeholder="分量（例: 200g / 大さじ1）" value="${escapeHtml(qty)}" required style="flex:1;">
      <button type="button" class="btn btn-danger btn-sm remove-row-btn">✕</button>
    `;
    row.querySelector('.remove-row-btn').addEventListener('click', () => {
      if (targetContainer.children.length > 1) {
        row.remove();
      } else {
        row.querySelector('.ing-name').value = '';
        row.querySelector('.ing-qty').value = '';
      }
    });
    targetContainer.appendChild(row);
  }

  addGroupBtn.addEventListener('click', () => {
    const container = addIngredientGroup();
    addIngredientRow(container);
  });

  // ── 手順行のUI生成 ──
  function addStepRow(title = '', desc = '', point = '') {
    const card = document.createElement('div');
    card.className = 'step-card-input';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <input type="text" class="step-title" placeholder="工程タイトル（例: 下準備、煮込む）" value="${escapeHtml(title)}" required style="flex:1; font-weight:bold;">
        <button type="button" class="btn btn-danger btn-sm remove-row-btn" style="margin-left:8px;">✕ 削除</button>
      </div>
      <textarea class="step-desc" rows="2" placeholder="手順の説明文..." required>${escapeHtml(desc)}</textarea>
      <input type="text" class="step-point" placeholder="💡 ポイント（任意）" value="${escapeHtml(point)}">
    `;
    card.querySelector('.remove-row-btn').addEventListener('click', () => card.remove());
    stepsContainer.appendChild(card);
  }

  addStepBtn.addEventListener('click', () => addStepRow());

  // 画像プレビュー
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
      attachedImageBase64 = null;
      imagePreview.innerHTML = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      attachedImageBase64 = reader.result.split(',')[1];
      imagePreview.innerHTML = `<img src="${reader.result}" alt="プレビュー">`;
    };
    reader.readAsDataURL(file);
  });

  // ── 新規作成モード ──
  newRecipeBtn.addEventListener('click', () => {
    recipeSelect.value = '';
    currentFileSha = null;
    formModeTitle.textContent = '新規レシピの作成';
    deleteRecipeBtn.style.display = 'none';
    viewPageBtn.style.display = 'none';
    slugInput.disabled = false;
    recipeForm.reset();
    imagePreview.innerHTML = '';
    attachedImageBase64 = null;
    groupsContainer.innerHTML = '';
    stepsContainer.innerHTML = '';

    const firstGroup = addIngredientGroup();
    addIngredientRow(firstGroup);
    addStepRow();
    editorSection.style.display = 'block';
  });

  // ── 既存レシピ読み込み ──
  recipeSelect.addEventListener('change', async () => {
    const slug = recipeSelect.value;
    if (!slug) {
      editorSection.style.display = 'none';
      return;
    }
    editorSection.style.display = 'block';
    formModeTitle.textContent = `レシピ編集: ${slug}`;
    deleteRecipeBtn.style.display = 'inline-block';
    
    // レシピページリンクの設定
    viewPageBtn.href = `${slug}.html`;
    viewPageBtn.style.display = 'inline-flex';

    slugInput.value = slug;
    slugInput.disabled = true;
    groupsContainer.innerHTML = '';
    stepsContainer.innerHTML = '';
    imagePreview.innerHTML = '';
    attachedImageBase64 = null;

    try {
      const fileData = await ghApi(`contents/recipes/${slug}.md`);
      currentFileSha = fileData.sha;
      const mdContent = base64ToUtf8(fileData.content);
      parseMarkdownToForm(mdContent);
    } catch (e) {
      alert(`レシピの読み込みに失敗しました: ${e.message}`);
    }
  });

  // ── Markdownのパース（材料グループ＆各種記法に対応） ──
  function parseMarkdownToForm(md) {
    const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!fmMatch) return;

    const fmText = fmMatch[1];
    const body = fmMatch[2];

    const getFmValue = (key) => {
      const m = fmText.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
      return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
    };

    titleInput.value = getFmValue('title');
    genreInput.value = getFmValue('genre');
    sourceInput.value = getFmValue('source');
    descInput.value = getFmValue('description');
    servingsInput.value = getFmValue('servings') || '2';

    // 材料セクション解析
    const ingSectionMatch = body.match(/## 材料\s*\n([\s\S]*?)(?=\n## 手順|$)/);
    if (ingSectionMatch) {
      const rawText = ingSectionMatch[1].trim();
      // ### 見出しで分割
      const rawBlocks = rawText.split(/(?=^###\s+)/m);

      rawBlocks.forEach(block => {
        let groupTitle = '';
        const titleMatch = block.match(/^###\s*(.+)$/m);
        let contentLines = block.split('\n');

        if (titleMatch) {
          // 【具材】などの囲み文字をきれいに保持
          groupTitle = titleMatch[1].replace(/^[【\[](.+?)[】\]]$/, '$1').trim();
          contentLines = block.replace(/^###\s+.+$/m, '').trim().split('\n');
        }

        const items = [];
        contentLines.forEach(line => {
          // 行頭 -, *, + および コロン : または ： に対応
          const m = line.match(/^[-*+]\s*(.+?)[:：]\s*(.+)$/);
          if (m) {
            items.push({ name: m[1].trim(), qty: m[2].trim() });
          }
        });

        if (items.length > 0 || groupTitle) {
          const groupContainer = addIngredientGroup(groupTitle);
          if (items.length > 0) {
            items.forEach(it => addIngredientRow(groupContainer, it.name, it.qty));
          } else {
            addIngredientRow(groupContainer);
          }
        }
      });
    }

    // 手順セクション解析
    const stepsSectionMatch = body.match(/## 手順\s*\n([\s\S]*)$/);
    if (stepsSectionMatch) {
      const stepBlocks = stepsSectionMatch[1].split(/(?=^###\s+)/m);
      stepBlocks.forEach(block => {
        const titleM = block.match(/^###\s+(.+)$/m);
        if (!titleM) return;
        const stepTitle = titleM[1].trim();
        const contentLines = block.replace(/^###\s+.+$/m, '').trim().split('\n');
        let point = '';
        const descLines = [];

        contentLines.forEach(l => {
          const pMatch = l.match(/^(?:>\s*\*\*ポイント\*\*|ポイント)[:：]\s*(.*)$/);
          if (pMatch) {
            point = pMatch[1].trim();
          } else if (l.trim()) {
            descLines.push(l.trim());
          }
        });
        addStepRow(stepTitle, descLines.join('\n'), point);
      });
    }

    if (!groupsContainer.children.length) {
      const g = addIngredientGroup();
      addIngredientRow(g);
    }
    if (!stepsContainer.children.length) addStepRow();
  }

  // ── Markdown生成（グループ構造を正確に出力） ──
  function buildMarkdownFromForm() {
    const today = new Date().toISOString().slice(0, 10);
    let md = '---\n';
    md += `title: "${titleInput.value.trim()}"\n`;
    if (sourceInput.value.trim()) {
      md += `source: "${sourceInput.value.trim()}"\n`;
    }
    md += `genre: "${genreInput.value.trim()}"\n`;
    md += `description: "${descInput.value.trim()}"\n`;
    md += `servings: ${servingsInput.value || 2}\n`;
    md += `updated: "${today}"\n`;
    md += '---\n\n';

    md += '## 材料\n\n';
    const groupCards = groupsContainer.querySelectorAll('.ingredient-group-card');
    groupCards.forEach(card => {
      const groupTitle = card.querySelector('.group-title-input').value.trim();
      if (groupTitle) {
        md += `### 【${groupTitle}】\n\n`;
      }
      const rows = card.querySelectorAll('.dynamic-row');
      rows.forEach(row => {
        const name = row.querySelector('.ing-name').value.trim();
        const qty = row.querySelector('.ing-qty').value.trim();
        if (name && qty) {
          md += `- ${name}: ${qty}\n`;
        }
      });
      md += '\n';
    });

    md += '## 手順\n\n';
    const stepCards = stepsContainer.querySelectorAll('.step-card-input');
    stepCards.forEach(card => {
      const title = card.querySelector('.step-title').value.trim();
      const desc = card.querySelector('.step-desc').value.trim();
      const point = card.querySelector('.step-point').value.trim();
      if (title) {
        md += `### ${title}\n\n${desc}\n`;
        if (point) {
          md += `\n> **ポイント**: ${point}\n`;
        }
        md += '\n';
      }
    });

    return md;
  }

  // ── 保存処理 ──
  recipeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = slugInput.value.trim();
    if (!slug) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ 保存中（GitHubへコミット中）...';

    try {
      const mdContent = buildMarkdownFromForm();
      const base64Content = utf8ToBase64(mdContent);

      if (!currentFileSha) {
        try {
          const existing = await ghApi(`contents/recipes/${slug}.md`);
          currentFileSha = existing.sha;
        } catch (_) {}
      }

      const mdPayload = {
        message: `Update recipe: ${slug}`,
        content: base64Content,
        branch: BRANCH
      };
      if (currentFileSha) mdPayload.sha = currentFileSha;

      await ghApi(`contents/recipes/${slug}.md`, {
        method: 'PUT',
        body: JSON.stringify(mdPayload)
      });

      if (attachedImageBase64) {
        let imgSha = null;
        try {
          const existingImg = await ghApi(`contents/recipes/img/${slug}_complete.jpg`);
          imgSha = existingImg.sha;
        } catch (_) {}

        const imgPayload = {
          message: `Update recipe image: ${slug}`,
          content: attachedImageBase64,
          branch: BRANCH
        };
        if (imgSha) imgPayload.sha = imgSha;

        await ghApi(`contents/recipes/img/${slug}_complete.jpg`, {
          method: 'PUT',
          body: JSON.stringify(imgPayload)
        });
      }

      alert(`✅ 保存が完了しました！\n約1〜2分後に反映されます。\n\n「OK」を押すと該当レシピのページを別タブで開けます。`);
      window.open(`${slug}.html`, '_blank');

      await loadRecipeList();
      recipeSelect.value = slug;
      recipeSelect.dispatchEvent(new Event('change'));
    } catch (err) {
      alert(`❌ 保存に失敗しました: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 GitHubに保存（コミット）';
    }
  });

  // ── 削除処理 ──
  deleteRecipeBtn.addEventListener('click', async () => {
    const slug = slugInput.value.trim();
    if (!confirm(`レシピ「${slug}」を完全に削除しますか？`)) return;

    try {
      deleteRecipeBtn.disabled = true;
      deleteRecipeBtn.textContent = '削除中...';

      await ghApi(`contents/recipes/${slug}.md`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `Delete recipe: ${slug}`,
          sha: currentFileSha,
          branch: BRANCH
        })
      });

      alert(`✅ レシピ「${slug}」を削除しました。`);
      editorSection.style.display = 'none';
      await loadRecipeList();
    } catch (e) {
      alert(`❌ 削除に失敗しました: ${e.message}`);
    } finally {
      deleteRecipeBtn.disabled = false;
      deleteRecipeBtn.textContent = '🗑️ 削除';
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  if (currentToken) {
    verifyAndInitToken(currentToken);
  }
})();
