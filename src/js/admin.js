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
  const authSection = document.getElementById('auth-section');
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
  const deleteRecipeBtn = document.getElementById('delete-recipe-btn');

  const slugInput = document.getElementById('recipe-slug');
  const titleInput = document.getElementById('recipe-title');
  const servingsInput = document.getElementById('recipe-servings');
  const genreInput = document.getElementById('recipe-genre');
  const sourceInput = document.getElementById('recipe-source');
  const descInput = document.getElementById('recipe-desc');
  const imageInput = document.getElementById('recipe-image');
  const imagePreview = document.getElementById('image-preview');

  const ingredientsContainer = document.getElementById('ingredients-container');
  const addIngredientBtn = document.getElementById('add-ingredient-btn');
  const stepsContainer = document.getElementById('steps-container-inputs');
  const addStepBtn = document.getElementById('add-step-btn');
  const submitBtn = document.getElementById('submit-btn');

  // ── GitHub API Helper ──
  async function ghApi(path, options = {}) {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/${path}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${currentToken}`,
      ...options.headers
    };
    const res = await fetch(url, { credentials: 'omit', ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `API Error: ${res.status}`);
    }
    return res.status !== 204 ? res.json() : true;
  }

  // UTF-8 対応 Base64 相互変換
  function utf8ToBase64(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
  }
  function base64ToUtf8(str) {
    return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  }

  // ── 認証状態管理 ──
  async function verifyAndInitToken(token) {
    if (!token) {
      authStatus.textContent = 'トークンが未設定です。';
      authStatus.className = 'status-badge error';
      clearTokenBtn.style.display = 'none';
      operationBar.style.display = 'none';
      editorSection.style.display = 'none';
      return;
    }
    currentToken = token;
    authStatus.textContent = 'GitHubに接続中...';
    authStatus.className = 'status-badge';

    try {
      await ghApi(''); // リポジトリのメタ情報取得で疎通確認
      localStorage.setItem(TOKEN_KEY, token);
      tokenInput.value = '••••••••••••••••••••';
      tokenInput.disabled = true;
      saveTokenBtn.style.display = 'none';
      clearTokenBtn.style.display = 'inline-block';
      authStatus.textContent = '✓ 接続成功: 編集権限を確認しました';
      authStatus.className = 'status-badge success';

      operationBar.style.display = 'block';
      loadRecipeList();
    } catch (e) {
      authStatus.textContent = `❌ 接続失敗: ${e.message}`;
      authStatus.className = 'status-badge error';
      tokenInput.disabled = false;
      saveTokenBtn.style.display = 'inline-block';
      clearTokenBtn.style.display = 'none';
    }
  }

  saveTokenBtn.addEventListener('click', () => verifyAndInitToken(tokenInput.value.trim()));
  clearTokenBtn.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    currentToken = '';
    tokenInput.value = '';
    tokenInput.disabled = false;
    saveTokenBtn.style.display = 'inline-block';
    verifyAndInitToken('');
  });

  // ── レシピ一覧取得 ──
  async function loadRecipeList() {
    recipeSelect.innerHTML = '<option value="">-- 読み込み中... --</option>';
    try {
      const contents = await ghApi('contents/recipes');
      recipesList = contents.filter(item => item.type === 'file' && item.name.endsWith('.md'));
      recipeSelect.innerHTML = '<option value="">-- 編集するレシピを選択 --</option>';
      recipesList.forEach(file => {
        const slug = file.name.replace(/\.md$/, '');
        const opt = document.createElement('option');
        opt.value = slug;
        opt.textContent = `${slug} (${file.name})`;
        recipeSelect.appendChild(opt);
      });
    } catch (e) {
      recipeSelect.innerHTML = '<option value="">取得エラー</option>';
      alert(`レシピ一覧の取得に失敗しました: ${e.message}`);
    }
  }

  reloadListBtn.addEventListener('click', loadRecipeList);

  // ── フォーム操作 (行追加・削除) ──
  function addIngredientRow(name = '', qty = '') {
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <input type="text" class="ing-name" placeholder="材料名（例: 鶏もも肉）" value="${escapeHtml(name)}" required style="flex:2;">
      <input type="text" class="ing-qty" placeholder="分量（例: 200g / 大さじ1）" value="${escapeHtml(qty)}" required style="flex:1;">
      <button type="button" class="btn btn-danger btn-sm remove-row-btn">✕</button>
    `;
    row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
    ingredientsContainer.appendChild(row);
  }

  function addStepRow(title = '', desc = '', point = '') {
    const card = document.createElement('div');
    card.className = 'step-card-input';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <input type="text" class="step-title" placeholder="工程タイトル（例: 下準備、煮込む）" value="${escapeHtml(title)}" required style="flex:1; font-weight:bold;">
        <button type="button" class="btn btn-danger btn-sm remove-row-btn" style="margin-left:8px;">✕ 削除</button>
      </div>
      <textarea class="step-desc" rows="2" placeholder="手順の説明文..." required>${escapeHtml(desc)}</textarea>
      <input type="text" class="step-point" placeholder="💡 ポイント（任意・コツなど）" value="${escapeHtml(point)}">
    `;
    card.querySelector('.remove-row-btn').addEventListener('click', () => card.remove());
    stepsContainer.appendChild(card);
  }

  addIngredientBtn.addEventListener('click', () => addIngredientRow());
  addStepBtn.addEventListener('click', () => addStepRow());

  // 画像選択時のBase64読み込み
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

  // ── 新規作成モードへの切り替え ──
  newRecipeBtn.addEventListener('click', () => {
    recipeSelect.value = '';
    currentFileSha = null;
    formModeTitle.textContent = '新規レシピの作成';
    deleteRecipeBtn.style.display = 'none';
    slugInput.disabled = false;
    recipeForm.reset();
    imagePreview.innerHTML = '';
    attachedImageBase64 = null;
    ingredientsContainer.innerHTML = '';
    stepsContainer.innerHTML = '';
    addIngredientRow();
    addStepRow();
    editorSection.style.display = 'block';
  });

  // ── 既存レシピの読み込み・解析 ──
  recipeSelect.addEventListener('change', async () => {
    const slug = recipeSelect.value;
    if (!slug) {
      editorSection.style.display = 'none';
      return;
    }
    editorSection.style.display = 'block';
    formModeTitle.textContent = `レシピ編集: ${slug}`;
    deleteRecipeBtn.style.display = 'inline-block';
    slugInput.value = slug;
    slugInput.disabled = true;
    ingredientsContainer.innerHTML = '';
    stepsContainer.innerHTML = '';
    imagePreview.innerHTML = '';
    attachedImageBase64 = null;

    try {
      const fileData = await ghApi(`contents/recipes/${slug}.md`);
      currentFileSha = fileData.sha;
      const mdContent = base64ToUtf8(fileData.content);
      parseMarkdownToForm(mdContent);
    } catch (e) {
      alert(`レシピの取得に失敗しました: ${e.message}`);
    }
  });

  // ── Markdownの解析 (Front Matter & セクション分解) ──
  function parseMarkdownToForm(md) {
    const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!fmMatch) return;

    const fmText = fmMatch[1];
    const body = fmMatch[2];

    // Front Matter 抽出
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
      const lines = ingSectionMatch[1].split('\n');
      lines.forEach(line => {
        const itemMatch = line.match(/^-\s*(.+?):\s*(.+)$/);
        if (itemMatch) {
          addIngredientRow(itemMatch[1].trim(), itemMatch[2].trim());
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
          const pMatch = l.match(/^(?:>\s*\*\*ポイント\*\*|ポイント):\s*(.*)$/);
          if (pMatch) {
            point = pMatch[1].trim();
          } else if (l.trim()) {
            descLines.push(l.trim());
          }
        });
        addStepRow(stepTitle, descLines.join('\n'), point);
      });
    }

    if (!ingredientsContainer.children.length) addIngredientRow();
    if (!stepsContainer.children.length) addStepRow();
  }

  // ── Markdownの生成 ──
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
    const ingRows = ingredientsContainer.querySelectorAll('.dynamic-row');
    ingRows.forEach(row => {
      const name = row.querySelector('.ing-name').value.trim();
      const qty = row.querySelector('.ing-qty').value.trim();
      if (name && qty) {
        md += `- ${name}: ${qty}\n`;
      }
    });

    md += '\n## 手順\n\n';
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

  // ── 保存処理 (コミット) ──
  recipeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = slugInput.value.trim();
    if (!slug) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ 保存中（GitHubへコミット中）...';

    try {
      const mdContent = buildMarkdownFromForm();
      const base64Content = utf8ToBase64(mdContent);

      // 既存のSHAを最新確認
      if (!currentFileSha) {
        try {
          const existing = await ghApi(`contents/recipes/${slug}.md`);
          currentFileSha = existing.sha;
        } catch (_) {}
      }

      // 1. Markdownファイルのコミット
      await ghApi(`contents/recipes/${slug}.md`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Update recipe: ${slug} [skip ci]`,
          content: base64Content,
          branch: BRANCH,
          sha: currentFileSha || undefined
        })
      });

      // 2. 完成写真があれば保存
      if (attachedImageBase64) {
        let imgSha = null;
        try {
          const existingImg = await ghApi(`contents/recipes/img/${slug}_complete.jpg`);
          imgSha = existingImg.sha;
        } catch (_) {}

        await ghApi(`contents/recipes/img/${slug}_complete.jpg`, {
          method: 'PUT',
          body: JSON.stringify({
            message: `Update recipe image: ${slug}`,
            content: attachedImageBase64,
            branch: BRANCH,
            sha: imgSha || undefined
          })
        });
      }

      alert('✅ 保存が完了しました！\nGitHub Actionsのビルド完了後（通常1〜2分）、サイトへ反映されます。');
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
    if (!confirm(`レシピ「${slug}」を完全に削除しますか？\n（この操作はGitHubのコミット履歴に残りますが、ファイルは削除されます）`)) {
      return;
    }

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
      deleteRecipeBtn.textContent = '🗑️ このレシピを削除';
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 初期化実行
  if (currentToken) {
    verifyAndInitToken(currentToken);
  }
})();
