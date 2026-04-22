// Vue 3 应用主逻辑
const { createApp } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

// API 基础地址
// 优先级：
// 1. window.JEMAIL_CONFIG.API_BASE
// 2. 当前 origin（本地或同源部署）
function normalizeApiBase(value) {
    return (value || '').replace(/\/+$/, '');
}

const runtimeConfig = window.JEMAIL_CONFIG || {};
const inferredApiBase = window.location.origin;
const API_BASE = normalizeApiBase(runtimeConfig.API_BASE) || normalizeApiBase(inferredApiBase);

// 创建Vue应用
const app = createApp({
    data() {
        return {
            apiBase: API_BASE,
            loading: false,
            accounts: [],
            selectedAccounts: [],
            total: 0,
            currentPage: 1,
            pageSize: 10,
            search: '',
            selectedGroup: '全部',
            groups: [],
            searchTimer: null,
            selectAllMode: false,
            jumpPage: 1,
            // Element Plus 中文配置
            zhCn: {
                name: 'zh-cn',
                el: {
                    pagination: {
                        goto: '跳转',
                        pagesize: '条/页',
                        total: '共 {total} 条',
                        pageClassifier: '页',
                        page: '页'
                    }
                }
            },

            // 邮件相关
            emailDialogVisible: false,
            currentEmail: '',
            currentFolder: 'inbox', // inbox 或 junkemail
            emails: [],
            filteredEmails: [],
            emailSearch: '',
            emailsLoading: false,

            // 邮件详情
            emailDetailVisible: false,
            currentEmailDetail: null,

            // 分组设置
            groupDialogVisible: false,
            selectedGroupName: '',

            // 新增分组
            addGroupDialogVisible: false,
            newGroupName: '',
            newGroupColor: '#409eff',
            presetColors: [
                '#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399',
                '#ff69b4', '#ba55d3', '#20b2aa', '#ff8c00', '#dc143c',
                '#32cd32', '#1e90ff', '#ff1493', '#00ced1', '#ffa500'
            ],

            // 删除分组
            deleteGroupDialogVisible: false,
            deleteGroupNames: [],

            // 分组颜色映射
            groupColors: {},

            // 导入相关
            importDialogVisible: false,
            importMethod: 'text',
            importText: '',
            importing: false,
            uploadOverwrite: false,
            selectedFile: null, // 存储选中的文件

            // 权限检测相关
            permissionDetecting: false,
            permissionDetectProgress: 0,
            permissionDetectTotal: 0,
        };
    },

    computed: {
        groupsForDelete() {
            return this.groups.filter(g => g.name !== '默认分组');
        },
        sanitizedCurrentEmailBody() {
            const email = this.currentEmailDetail || {};
            const rawBody = email.body || email.body_html || email.body_preview || '';
            return this.buildSafeEmailDocument(rawBody);
        },
        importTextLineCount() {
            if (!this.importText) return 0;
            return this.importText.trim().split('\n').filter(line => line.trim()).length;
        }
    },

    async mounted() {
        // 初始化浏览器本地数据库
        try {
            await localDB.init();
        } catch (error) {
            console.error('❌ 数据库初始化失败:', error);
            ElMessage.error('数据库初始化失败: ' + error.message);
            return;
        }

        this.loadGroupColorsFromStorage();
        await this.init();
    },

    methods: {
        // ==================== 初始化 ====================
        async init() {
            await this.loadGroups();
            await this.loadAccounts();
        },

        // ==================== 数据规范化与安全渲染 ====================
        isKnownProvider(provider) {
            return ['microsoft', 'google'].includes(String(provider || '').trim().toLowerCase());
        },

        inferProviderFromEmail(email) {
            const domain = String(email || '').trim().toLowerCase().split('@').pop() || '';
            return ['gmail.com', 'googlemail.com'].includes(domain) ? 'google' : 'microsoft';
        },

        normalizeProvider(provider, email) {
            const normalized = String(provider || '').trim().toLowerCase();
            if (this.isKnownProvider(normalized)) {
                return normalized;
            }
            return this.inferProviderFromEmail(email);
        },

        normalizeAccountRecord(account) {
            const email = account?.邮箱地址 || account?.email_address || '';
            return {
                ...account,
                provider: this.normalizeProvider(account?.provider, email)
            };
        },

        createAccountRecord({ email, password = '', clientId = '', refreshToken = '', tokenExpiresAt = '', group = '', provider = '' }) {
            return this.normalizeAccountRecord({
                邮箱地址: email,
                密码: password,
                client_id: clientId,
                刷新令牌: refreshToken,
                令牌过期时间: tokenExpiresAt,
                分组: group || '默认分组',
                provider
            });
        },

        isBlockedRefreshToken(refreshToken) {
            return ['封禁', '锁定', '过期', '无效'].includes(String(refreshToken || '').trim());
        },

        escapeHtml(value) {
            return String(value || '').replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[char]);
        },

        looksLikeHtml(value) {
            return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
        },

        decodeHtmlEntities(value) {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = String(value || '');
            return textarea.value;
        },

        isDangerousEmailUrl(value) {
            const decoded = this.decodeHtmlEntities(value).trim();
            const compact = decoded.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
            if (!compact) return false;
            if (compact.startsWith('javascript:') || compact.startsWith('vbscript:') || compact.startsWith('file:')) {
                return true;
            }
            if (compact.startsWith('data:')) {
                return !/^data:image\/(png|jpe?g|gif|webp|bmp|avif);/i.test(compact);
            }
            return false;
        },

        isUrlAttribute(attrName) {
            return [
                'href',
                'src',
                'xlink:href',
                'action',
                'formaction',
                'poster',
                'background'
            ].includes(attrName);
        },

        sanitizeInlineStyle(value) {
            const decoded = this.decodeHtmlEntities(value);
            if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(decoded)) {
                return '';
            }
            return decoded.replace(/url\(([^)]*)\)/gi, (match, rawUrl) => {
                const unquoted = rawUrl.trim().replace(/^['"]|['"]$/g, '');
                return this.isDangerousEmailUrl(unquoted) ? 'url(about:blank)' : match;
            });
        },

        sanitizeEmailHtml(rawHtml) {
            const raw = String(rawHtml || '');
            if (!raw.trim()) return '';
            if (!this.looksLikeHtml(raw)) {
                return this.escapeHtml(raw).replace(/\r\n|\n|\r/g, '<br>');
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(raw, 'text/html');
            const dangerousTags = [
                'script',
                'iframe',
                'object',
                'embed',
                'form',
                'meta',
                'link',
                'base',
                'frame',
                'frameset',
                'applet',
                'style'
            ];

            dangerousTags.forEach(tag => {
                doc.querySelectorAll(tag).forEach(node => node.remove());
            });

            doc.body.querySelectorAll('*').forEach(element => {
                Array.from(element.attributes).forEach(attribute => {
                    const attrName = attribute.name.toLowerCase();
                    const attrValue = attribute.value || '';

                    if (attrName.startsWith('on') || attrName === 'srcdoc') {
                        element.removeAttribute(attribute.name);
                        return;
                    }

                    if (attrName === 'style') {
                        const sanitizedStyle = this.sanitizeInlineStyle(attrValue);
                        if (sanitizedStyle) {
                            element.setAttribute(attribute.name, sanitizedStyle);
                        } else {
                            element.removeAttribute(attribute.name);
                        }
                        return;
                    }

                    if (this.isUrlAttribute(attrName) && this.isDangerousEmailUrl(attrValue)) {
                        element.removeAttribute(attribute.name);
                    }
                });

                if (element.tagName.toLowerCase() === 'a') {
                    element.setAttribute('target', '_blank');
                    element.setAttribute('rel', 'noopener noreferrer');
                }
            });

            return doc.body.innerHTML;
        },

        buildSafeEmailDocument(rawHtml) {
            const sanitizedBody = this.sanitizeEmailHtml(rawHtml);
            return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; img-src http: https: data: cid: blob:; style-src 'unsafe-inline'; font-src data: https:;">
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: #1e293b;
            background: #ffffff;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        img {
            max-width: 100% !important;
            height: auto !important;
            display: inline-block;
            vertical-align: middle;
        }
        img[src=""],
        img:not([src]),
        img[src*="cid:"],
        img[width="1"],
        img[height="1"],
        img[src^="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"] {
            display: none !important;
            visibility: hidden !important;
            width: 0 !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            opacity: 0 !important;
        }
        a {
            color: #0078d4;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        table {
            border-collapse: collapse;
            max-width: 100%;
            width: 100%;
        }
        table td,
        table th {
            padding: 8px;
            vertical-align: top;
        }
        * {
            max-width: 100%;
            box-sizing: border-box;
        }
        [width] {
            width: auto !important;
            max-width: 100% !important;
        }
        p {
            margin: 0 0 12px 0;
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
            margin: 16px 0 12px 0;
            line-height: 1.3;
        }
    </style>
</head>
<body>${sanitizedBody}</body>
</html>`;
        },

        // ==================== 账号管理 ====================
        async loadAccounts() {
            this.loading = true;
            try {
                // 从浏览器本地数据库读取所有账号
                let allAccounts = (await localDB.getAllAccounts()).map(account => this.normalizeAccountRecord(account));

                // 筛选分组
                if (this.selectedGroup && this.selectedGroup !== '全部') {
                    allAccounts = allAccounts.filter(acc =>
                        (acc.分组 || '默认分组') === this.selectedGroup
                    );
                }

                // 搜索过滤
                if (this.search) {
                    const keyword = this.search.toLowerCase();
                    allAccounts = allAccounts.filter(acc =>
                        acc.邮箱地址 && acc.邮箱地址.toLowerCase().includes(keyword)
                    );
                }

                // 总数
                this.total = allAccounts.length;

                // 分页
                const start = (this.currentPage - 1) * this.pageSize;
                const end = start + this.pageSize;
                this.accounts = allAccounts.slice(start, end);

            } catch (error) {
                console.error('❌ 加载账号失败:', error);
                ElMessage.error('加载账号失败: ' + error.message);
            } finally {
                this.loading = false;
            }
        },

        async loadGroups() {
            try {
                // 从浏览器本地数据库获取所有分组
                const groupNames = await localDB.getAllGroups();
                const groupCounts = await localDB.getGroupCounts();

                const dbGroups = groupNames.map(name => ({
                    name: name,
                    color: this.groupColors[name] || this.getDefaultGroupColor(name),
                    count: groupCounts[name] || 0
                }));

                // 合并自定义分组（从 localStorage）
                const customGroups = this.getCustomGroups();
                const allGroupNames = new Set(dbGroups.map(g => g.name));

                customGroups.forEach(cg => {
                    if (!allGroupNames.has(cg.name)) {
                        dbGroups.push({
                            name: cg.name,
                            color: cg.color,
                            count: 0
                        });
                    }
                });

                this.groups = dbGroups;
            } catch (error) {
                console.error('加载分组失败:', error);
            }
        },

        loadGroupColorsFromStorage() {
            const saved = localStorage.getItem('groupColors');
            if (saved) {
                try {
                    this.groupColors = JSON.parse(saved);
                } catch (e) {
                    console.error('加载分组颜色失败:', e);
                }
            }
        },

        saveGroupColorsToStorage() {
            localStorage.setItem('groupColors', JSON.stringify(this.groupColors));
        },

        getCustomGroups() {
            const saved = localStorage.getItem('customGroups');
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch (e) {
                    return [];
                }
            }
            return [];
        },

        saveCustomGroup(name, color) {
            const customGroups = this.getCustomGroups();
            if (!customGroups.find(g => g.name === name)) {
                customGroups.push({ name, color });
                localStorage.setItem('customGroups', JSON.stringify(customGroups));
            }
        },

        removeCustomGroup(name) {
            const customGroups = this.getCustomGroups();
            const filtered = customGroups.filter(g => g.name !== name);
            localStorage.setItem('customGroups', JSON.stringify(filtered));
        },

        getDefaultGroupColor(groupName) {
            // 根据分组名生成默认颜色
            const colors = this.presetColors;
            let hash = 0;
            for (let i = 0; i < groupName.length; i++) {
                hash = groupName.charCodeAt(i) + ((hash << 5) - hash);
            }
            return colors[Math.abs(hash) % colors.length];
        },

        getGroupColor(groupName) {
            if (!groupName) groupName = '默认分组';
            const group = this.groups.find(g => g.name === groupName);
            return group ? group.color : this.getDefaultGroupColor(groupName);
        },

        handleSearch() {
            // 防抖搜索
            clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                this.currentPage = 1;
                this.loadAccounts();
            }, 500);
        },

        handleGroupChange() {
            this.currentPage = 1;
            this.loadAccounts();
        },

        handlePageSizeChange() {
            this.currentPage = 1;
            this.loadAccounts();
        },

        handleSelectionChange(selection) {
            this.selectedAccounts = selection;
        },

        // ==================== 导入 ====================
        openImportDialog() {
            this.importDialogVisible = true;
            this.importText = '';
            this.importMethod = 'text';
            this.selectedFile = null;
            // 清空上传组件
            if (this.$refs.uploadRef) {
                this.$refs.uploadRef.clearFiles();
            }
        },

        // 文件选择变化
        handleFileChange(file, fileList) {
            this.selectedFile = file.raw;
        },

        getProviderFromTextParts(parts, email) {
            if (parts[6]) {
                return this.normalizeProvider(parts[6], email);
            }
            if (parts.length === 5 && this.isKnownProvider(parts[4])) {
                return this.normalizeProvider(parts[4], email);
            }
            return this.normalizeProvider('', email);
        },

        getTokenExpiryFromTextParts(parts) {
            if (parts.length === 5 && this.isKnownProvider(parts[4])) {
                return '';
            }
            return parts[4] || '';
        },

        // 解析文本行为账号数据（提取公共逻辑）
        parseTextToAccounts(text) {
            const lines = text.trim().split('\n');
            const accounts = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                let parts = [];

                // 判断分隔符：优先Tab，其次----
                if (trimmed.includes('\t')) {
                    parts = trimmed.split('\t').map(s => s.trim());
                } else if (trimmed.includes('----')) {
                    parts = trimmed.split('----').map(s => s.trim());
                } else {
                    parts = [trimmed];
                }

                const email = parts[0] || '';
                if (!email || !email.includes('@')) {
                    continue;
                }

                const account = this.createAccountRecord({
                    email,
                    password: parts[1] || '',
                    clientId: parts[2] || '',
                    refreshToken: parts[3] || '',
                    tokenExpiresAt: this.getTokenExpiryFromTextParts(parts),
                    group: parts[5] || '默认分组',
                    provider: this.getProviderFromTextParts(parts, email)
                });

                accounts.push(account);
            }

            return accounts;
        },

        async handleImport(isOverwrite = false) {
            // 如果是覆盖导入，显示确认对话框
            if (isOverwrite) {
                try {
                    await ElMessageBox.confirm(
                        '覆盖导入将清空所有现有账号数据，此操作不可恢复！确定要继续吗？',
                        '警告',
                        {
                            confirmButtonText: '确定覆盖',
                            cancelButtonText: '取消',
                            type: 'warning',
                            dangerouslyUseHTMLString: false
                        }
                    );
                } catch {
                    // 用户取消
                    return;
                }
            }

            if (this.importMethod === 'text') {
                await this.importFromText(isOverwrite);
            } else {
                await this.importFromFile(isOverwrite);
            }
        },

        async importFromText(isOverwrite = false) {
            if (!this.importText || !this.importText.trim()) {
                ElMessage.warning('请在"文本导入"标签页中粘贴账号信息后再点击导入！');
                return;
            }

            this.importing = true;
            try {
                // 使用公共解析方法
                const accounts = this.parseTextToAccounts(this.importText);

                if (accounts.length === 0) {
                    ElMessage.warning('未解析到有效的账号信息');
                    return;
                }

                // 如果是覆盖导入，先清空
                if (isOverwrite) {
                    await localDB.clearAll();
                }

                // 导入到浏览器本地数据库（立即完成，不等待权限检测）
                const result = await localDB.addAccounts(accounts);

                ElMessage.success(`成功导入 ${result.success} 个账号`);
                this.importDialogVisible = false;

                await this.loadAccounts();
                await this.loadGroups();

                // 不再自动检测权限，等用户点击"查看"时再检测
                // this.batchDetectPermissions(accounts);
            } catch (error) {
                console.error('❌ 导入失败:', error);
                ElMessage.error('导入失败: ' + error.message);
            } finally {
                this.importing = false;
            }
        },

        async importFromFile(isOverwrite = false) {
            // 使用存储的文件
            if (!this.selectedFile) {
                ElMessage.warning('请先选择要导入的文件');
                return;
            }

            const file = this.selectedFile;

            this.importing = true;

            try {
                let accounts = [];

                // 判断文件类型
                const fileName = file.name.toLowerCase();
                if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                    // Excel 文件：前端直接解析（使用 SheetJS）
                    accounts = await this.parseExcelFile(file);
                } else {
                    // TXT 文件：前端直接解析
                    const text = await this.readFileAsText(file);

                    // 使用公共解析方法
                    accounts = this.parseTextToAccounts(text);
                }

                if (accounts.length === 0) {
                    ElMessage.warning('文件中未找到有效的账号信息');
                    return;
                }

                // 如果是覆盖导入，先清空
                if (isOverwrite) {
                    await localDB.clearAll();
                }

                // 导入到浏览器本地数据库（立即完成，不等待权限检测）
                const result = await localDB.addAccounts(accounts);

                ElMessage.success(`成功导入 ${result.success} 个账号`);
                this.importDialogVisible = false;

                // 清空上传组件和选中文件
                if (this.$refs.uploadRef) {
                    this.$refs.uploadRef.clearFiles();
                }
                this.selectedFile = null;

                await this.loadAccounts();
                await this.loadGroups();

                // 不再自动检测权限，等用户点击"查看"时再检测
                // this.batchDetectPermissions(accounts);
            } catch (error) {
                console.error('❌ 文件导入失败:', error);
                ElMessage.error('文件导入失败: ' + error.message);
            } finally {
                this.importing = false;
            }
        },

        // 读取文件为文本
        readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(new Error('文件读取失败'));
                reader.readAsText(file, 'utf-8');
            });
        },

        // 解析Excel文件（前端实现）
        parseExcelFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });

                        // 获取第一个工作表
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];

                        // 转换为JSON数组（保持原始顺序）
                        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                            header: 1,  // 使用数组格式，不使用对象格式
                            defval: ''  // 空单元格默认值
                        });

                        const accounts = [];

                        // 从第1行开始（跳过标题行，如果有的话）
                        // 判断第一行是否为标题
                        let startRow = 0;
                        if (jsonData.length > 0) {
                            const firstRow = jsonData[0];
                            const firstCell = String(firstRow[0] || '').toLowerCase();
                            // 如果第一行包含"邮箱"、"email"等关键字，视为标题行
                            if (firstCell.includes('邮箱') || firstCell.includes('email') || firstCell.includes('账号')) {
                                startRow = 1;
                            }
                        }

                        const headerRow = startRow === 1 ? jsonData[0] : [];
                        const providerColumnIndex = headerRow.findIndex(cell => {
                            const title = String(cell || '').trim().toLowerCase();
                            return ['provider', '服务商', '平台'].includes(title);
                        });

                        // 解析数据行（保持文件中的顺序）
                        for (let i = startRow; i < jsonData.length; i++) {
                            const row = jsonData[i];

                            // 跳过空行
                            if (!row || row.length === 0 || !row[0]) continue;

                            const email = String(row[0] || '').trim();

                            // 验证邮箱格式
                            if (!email || !email.includes('@')) {
                                continue;
                            }

                            // 构建账号对象
                            // Excel格式：第1列邮箱，第2列密码，第3列client_id，第4列刷新令牌，第5列令牌过期时间，第6列分组，第7列provider
                            const providerValue = providerColumnIndex >= 0 ? row[providerColumnIndex] : row[6];
                            const account = this.createAccountRecord({
                                email,
                                password: String(row[1] || '').trim(),
                                clientId: String(row[2] || '').trim(),
                                refreshToken: String(row[3] || '').trim(),
                                tokenExpiresAt: String(row[4] || '').trim(),
                                group: String(row[5] || '默认分组').trim() || '默认分组',
                                provider: String(providerValue || '').trim()
                            });

                            accounts.push(account);
                        }

                        resolve(accounts);

                    } catch (error) {
                        console.error('❌ Excel解析失败:', error);
                        reject(new Error('Excel文件解析失败: ' + error.message));
                    }
                };

                reader.onerror = () => {
                    reject(new Error('文件读取失败'));
                };

                // 读取为ArrayBuffer
                reader.readAsArrayBuffer(file);
            });
        },

        handleImportSuccess(response) {
            if (response.success) {
                ElMessage.success(response.message);
                this.importDialogVisible = false;
                this.loadAccounts();
                this.loadGroups();
            } else {
                ElMessage.error(response.message || '导入失败');
            }
        },

        handleImportError(error) {
            ElMessage.error('导入失败: ' + error.message);
        },

        // ==================== 删除 ====================
        async deleteAccount(email) {
            try {
                await ElMessageBox.confirm('确定要删除这个账号吗？', '警告', {
                    type: 'warning',
                    confirmButtonText: '确定',
                    cancelButtonText: '取消'
                });

                // 从浏览器本地数据库删除
                await localDB.deleteAccount(email);

                ElMessage.success('删除成功');
                await this.loadAccounts();
            } catch (error) {
                if (error !== 'cancel') {
                    ElMessage.error('删除失败: ' + error.message);
                }
            }
        },

        async handleBatchDelete() {
            let accounts = [];

            // 如果是全选模式，获取所有数据
            if (this.selectAllMode) {
                // 使用 IndexedDB 获取所有账号（应用当前筛选条件）
                let allAccounts = await localDB.getAllAccounts();

                // 应用搜索筛选
                if (this.search) {
                    const searchLower = this.search.toLowerCase();
                    allAccounts = allAccounts.filter(acc =>
                        acc.邮箱地址?.toLowerCase().includes(searchLower) ||
                        acc.密码?.toLowerCase().includes(searchLower)
                    );
                }

                // 应用分组筛选
                if (this.selectedGroup !== '全部') {
                    allAccounts = allAccounts.filter(acc => acc.分组 === this.selectedGroup);
                }

                accounts = allAccounts;
            } else {
                if (this.selectedAccounts.length === 0) {
                    ElMessage.warning('请先选择要删除的账号');
                    return;
                }
                accounts = this.selectedAccounts;
            }

            if (accounts.length === 0) {
                ElMessage.warning('没有可删除的账号');
                return;
            }

            try {
                await ElMessageBox.confirm(
                    `确定要删除选中的 ${accounts.length} 个账号吗？此操作不可恢复！`,
                    '警告',
                    { type: 'warning' }
                );

                const emails = accounts.map(acc => acc.邮箱地址);

                // 使用 IndexedDB 批量删除
                await localDB.batchDeleteAccounts(emails);

                // 如果是全选模式，清除标志
                if (this.selectAllMode) {
                    this.selectAllMode = false;
                }

                ElMessage.success(`成功删除 ${emails.length} 个账号`);
                this.loadAccounts();
            } catch (error) {
                if (error !== 'cancel') {
                    ElMessage.error('删除失败: ' + error.message);
                }
            }
        },

        // ==================== 批量设置分组 ====================
        openGroupDialog() {
            if (this.selectedAccounts.length === 0) {
                ElMessage.warning('请先选择要设置分组的账号');
                return;
            }

            this.selectedGroupName = '';
            this.groupDialogVisible = true;
        },

        async batchUpdateGroup() {
            if (this.selectedAccounts.length === 0) {
                ElMessage.warning('请先选择要设置分组的账号');
                return;
            }

            if (!this.selectedGroupName) {
                ElMessage.warning('请选择分组名称');
                return;
            }

            try {
                const email_addresses = this.selectedAccounts.map(acc => acc.邮箱地址);

                // 使用 IndexedDB 批量更新分组
                const result = await localDB.batchUpdateGroup(email_addresses, this.selectedGroupName);

                ElMessage.success(`成功设置 ${result.success} 个账号的分组`);
                this.groupDialogVisible = false;
                await this.loadGroups();
                await this.loadAccounts();
            } catch (error) {
                ElMessage.error('设置分组失败: ' + (error.response?.data?.detail || error.message));
            }
        },

        // ==================== 新增分组 ====================
        openAddGroupDialog() {
            this.newGroupName = '';
            this.newGroupColor = this.presetColors[0];
            this.addGroupDialogVisible = true;
        },

        async addGroup() {
            if (!this.newGroupName || !this.newGroupName.trim()) {
                ElMessage.warning('请输入分组名称');
                return;
            }

            const groupName = this.newGroupName.trim();

            // 检查分组是否已存在
            if (this.groups.find(g => g.name === groupName)) {
                ElMessage.warning('该分组已存在');
                return;
            }

            try {
                // 保存到 localStorage
                this.saveCustomGroup(groupName, this.newGroupColor);

                // 保存颜色映射
                this.groupColors[groupName] = this.newGroupColor;
                this.saveGroupColorsToStorage();

                // 添加到本地列表
                this.groups.push({
                    name: groupName,
                    color: this.newGroupColor,
                    count: 0
                });

                ElMessage.success('分组创建成功');
                this.addGroupDialogVisible = false;
            } catch (error) {
                ElMessage.error('创建分组失败: ' + error.message);
            }
        },

        // ==================== 删除分组 ====================
        openDeleteGroupDialog() {
            this.deleteGroupNames = [];
            this.deleteGroupDialogVisible = true;
        },

        toggleGroupSelection(groupName) {
            const index = this.deleteGroupNames.indexOf(groupName);
            if (index > -1) {
                this.deleteGroupNames.splice(index, 1);
            } else {
                this.deleteGroupNames.push(groupName);
            }
        },

        async batchDeleteGroups() {
            if (this.deleteGroupNames.length === 0) {
                ElMessage.warning('请选择要删除的分组');
                return;
            }

            try {
                await ElMessageBox.confirm(
                    `确定要删除选中的 ${this.deleteGroupNames.length} 个分组吗？这些分组下的所有账号将被设置为"默认分组"`,
                    '警告',
                    { type: 'warning' }
                );

                // 批量删除
                let successCount = 0;
                for (const groupName of this.deleteGroupNames) {
                    try {
                        // 使用 IndexedDB 删除分组（将该分组的账号改为默认分组）
                        await localDB.deleteGroup(groupName);

                        // 从 localStorage 中删除
                        this.removeCustomGroup(groupName);
                        delete this.groupColors[groupName];
                        successCount++;
                    } catch (error) {
                        console.error(`删除分组 ${groupName} 失败:`, error);
                    }
                }

                this.saveGroupColorsToStorage();
                ElMessage.success(`成功删除 ${successCount} 个分组`);
                this.deleteGroupDialogVisible = false;
                await this.loadGroups();
                await this.loadAccounts();
            } catch (error) {
                if (error !== 'cancel') {
                    ElMessage.error('删除分组失败: ' + (error.response?.data?.detail || error.message));
                }
            }
        },

        // ==================== 批量复制 ====================
        async handleBatchCopy(command) {
            let data = [];
            let accounts = [];

            // 如果是全选模式，获取所有数据
            if (this.selectAllMode) {
                // 使用 IndexedDB 获取所有账号（应用当前筛选条件）
                let allAccounts = await localDB.getAllAccounts();

                // 应用搜索筛选
                if (this.search) {
                    const searchLower = this.search.toLowerCase();
                    allAccounts = allAccounts.filter(acc =>
                        acc.邮箱地址?.toLowerCase().includes(searchLower) ||
                        acc.密码?.toLowerCase().includes(searchLower)
                    );
                }

                // 应用分组筛选
                if (this.selectedGroup !== '全部') {
                    allAccounts = allAccounts.filter(acc => acc.分组 === this.selectedGroup);
                }

                accounts = allAccounts;
            } else {
                if (this.selectedAccounts.length === 0) {
                    ElMessage.warning('请先选择要复制的账号');
                    return;
                }
                accounts = this.selectedAccounts;
            }

            // 根据命令生成不同格式的数据
            if (command === 'accounts') {
                data = accounts.map(acc => acc.邮箱地址);
            } else if (command === 'passwords') {
                data = accounts.filter(acc => acc.密码).map(acc => acc.密码);
            } else if (command === 'both') {
                data = accounts.filter(acc => acc.密码).map(acc => `${acc.邮箱地址}----${acc.密码}`);
            }

            if (data.length === 0) {
                ElMessage.warning('没有可复制的数据');
                return;
            }

            // 复制到剪贴板
            const text = data.join('\n');
            try {
                await navigator.clipboard.writeText(text);
                ElMessage.success(`已复制 ${data.length} 条数据到剪贴板`);
            } catch (error) {
                // 降级方案
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                ElMessage.success(`已复制 ${data.length} 条数据到剪贴板`);
            }
        },

        // ==================== 右键菜单 ====================
        handleRowMenu(command, row) {
            if (command === 'check') {
                // 勾选本行
                this.$refs.table?.toggleRowSelection(row, true);
                ElMessage.success('已勾选本行');
            } else if (command === 'checkFrom') {
                // 从本行勾选N个
                this.checkFromRow(row);
            } else if (command === 'checkAll') {
                // 勾选全部数据
                this.checkAllData();
            } else if (command === 'uncheckAll') {
                // 取消全部勾选
                this.$refs.table?.clearSelection();
                this.selectAllMode = false;
                ElMessage.success('已取消全部勾选');
            }
        },

        async checkFromRow(startRow) {
            try {
                const { value } = await ElMessageBox.prompt('请输入要勾选的数量', '从本行勾选N个', {
                    inputPattern: /^[1-9]\d*$/,
                    inputErrorMessage: '请输入有效的正整数'
                });

                const count = parseInt(value);
                const startIndex = this.accounts.findIndex(acc => acc.邮箱地址 === startRow.邮箱地址);

                if (startIndex !== -1) {
                    const toSelect = this.accounts.slice(startIndex, startIndex + count);
                    toSelect.forEach(row => {
                        this.$refs.table?.toggleRowSelection(row, true);
                    });
                    ElMessage.success(`已勾选 ${toSelect.length} 个账号`);
                }
            } catch (error) {
                // 用户取消
            }
        },

        checkAllData() {
            this.selectAllMode = true;
            // 勾选当前页所有行
            this.accounts.forEach(row => {
                this.$refs.table?.toggleRowSelection(row, true);
            });
            ElMessage.success(`已启用全选模式！批量复制将复制所有 ${this.total} 个账号`);
        },

        // ==================== 权限检测 ====================
        /**
         * 检测单个账号的权限（通过后端API）
         */
        async detectAccountPermission(account) {
            try {
                const provider = this.normalizeProvider(account.provider, account.邮箱地址);
                if (provider === 'google') {
                    return { success: true, token_type: 'gmail_api', use_local_ip: false };
                }

                // 调用后端API检测权限
                const response = await fetch(`${this.apiBase}/detect-permission`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: account.client_id,
                        refresh_token: account.刷新令牌
                    })
                });

                if (!response.ok) {
                    console.error(`权限检测失败: HTTP ${response.status}`);
                    return { success: false, token_type: 'unknown', use_local_ip: false };
                }

                const data = await response.json();

                if (!data.success) {
                    return { success: false, token_type: 'unknown', use_local_ip: false };
                }

                return {
                    success: true,
                    token_type: data.token_type,
                    use_local_ip: data.use_local_ip
                };
            } catch (error) {
                console.error('权限检测异常:', error?.message || error);
                return { success: false, token_type: 'unknown', use_local_ip: false };
            }
        },

        /**
         * 批量检测账号权限（10个并发，每轮间隔3秒）
         */
        async batchDetectPermissions(accounts) {
            this.permissionDetecting = true;
            this.permissionDetectProgress = 0;
            this.permissionDetectTotal = accounts.length;

            const batchSize = 10;
            const delayBetweenBatches = 3000; // 3秒

            for (let i = 0; i < accounts.length; i += batchSize) {
                const batch = accounts.slice(i, i + batchSize);

                // 并发检测当前批次
                const promises = batch.map(async (account) => {
                    const result = await this.detectAccountPermission(account);

                    // 无论成功或失败，都更新数据库
                    await localDB.updateAccountPermission(account.邮箱地址, {
                        token_type: result.token_type,
                        use_local_ip: result.use_local_ip
                    });

                    this.permissionDetectProgress++;
                    return result;
                });

                await Promise.all(promises);

                // 如果不是最后一批，等待3秒
                if (i + batchSize < accounts.length) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                }
            }

            this.permissionDetecting = false;

            // 刷新账号列表
            await this.loadAccounts();

            ElMessage.success(`权限检测完成！共检测 ${accounts.length} 个账号`);
        },

        /**
         * 本地直接调用Microsoft API获取邮件
         */
        async fetchEmailsLocally(account) {
            try {
                // 1. 获取access_token
                const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        'client_id': account.client_id,
                        'grant_type': 'refresh_token',
                        'refresh_token': account.刷新令牌
                    })
                });

                if (!tokenResponse.ok) {
                    throw new Error('获取access_token失败');
                }

                const tokenData = await tokenResponse.json();
                const accessToken = tokenData.access_token;

                // 2. 调用Graph API获取邮件
                const mailbox = this.currentFolder === 'junkemail' ? 'junkemail' : 'inbox';
                const graphUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/${mailbox}/messages?$top=100`;

                const emailsResponse = await fetch(graphUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!emailsResponse.ok) {
                    throw new Error('获取邮件失败');
                }

                const emailsData = await emailsResponse.json();
                const emails = emailsData.value || [];

                // 3. 转换为统一格式
                const convertedEmails = emails.map(item => ({
                    subject: item.subject || '(无主题)',
                    from_address: item.from?.emailAddress?.address || '未知发件人',
                    from_name: item.from?.emailAddress?.name || '',
                    received_time: item.receivedDateTime || new Date().toISOString(),
                    body_preview: item.bodyPreview || '',
                    body_html: item.body?.content || '',
                    邮箱地址: account.邮箱地址,
                    folder: this.currentFolder
                }));

                // 返回与服务器API相同的格式
                return {
                    data: {
                        success: true,
                        emails: convertedEmails
                    }
                };
            } catch (error) {
                console.error('本地API调用失败:', error);
                return {
                    data: {
                        success: false,
                        message: error.message
                    }
                };
            }
        },

        // ==================== 邮件管理 ====================
        async viewEmails(email) {
            this.currentEmail = email;
            this.currentFolder = 'inbox'; // 默认显示收件箱
            this.currentEmailDetail = null; // 清除之前的邮件详情

            // 先打开对话框，避免等待时的空白
            this.emailDialogVisible = true;

            // 使用 nextTick 确保 DOM 更新后再加载数据，避免闪烁
            await this.$nextTick();

            // 直接从后端获取邮件，不使用IndexedDB缓存
            this.refreshEmailsFromServer();
        },

        async onEmailDialogClose() {
            // 对话框关闭时，刷新账号列表（显示权限检测结果）
            await this.loadAccounts();
        },

        async switchFolder() {
            this.currentEmailDetail = null; // 清除之前的邮件详情
            // 直接从后端获取邮件，不使用IndexedDB缓存
            this.refreshEmailsFromServer();
        },

        async refreshEmailsFromServer() {
            // 刷新邮件 - 根据账号权限类型选择调用方式
            this.emailsLoading = true;
            // 不立即清空列表，避免闪烁，等新数据到达后再替换

            try {
                // 获取当前账号信息
                const accounts = await localDB.getAllAccounts();
                const currentAccount = accounts.find(acc => acc.邮箱地址 === this.currentEmail);

                if (!currentAccount) {
                    ElMessage.error('未找到账号信息');
                    return;
                }

                let { client_id, 刷新令牌, 令牌类型, 权限已检测 } = currentAccount;
                const provider = this.normalizeProvider(currentAccount.provider, currentAccount.邮箱地址);

                if (!刷新令牌 || this.isBlockedRefreshToken(刷新令牌) || (provider === 'microsoft' && !client_id)) {
                    ElMessage.warning('账号缺少必要信息或令牌异常，无法刷新邮件');
                    return;
                }

                if (provider === 'google') {
                    令牌类型 = 令牌类型 || 'gmail_api';
                } else if (!权限已检测 || !令牌类型) {
                    // 如果 Microsoft 权限还没检测过，先检测权限
                    const permissionResult = await this.detectAccountPermission(currentAccount);

                    // 静默更新数据库（不刷新UI，避免跳动）
                    await localDB.updateAccountPermission(currentAccount.邮箱地址, {
                        token_type: permissionResult.token_type,
                        use_local_ip: permissionResult.use_local_ip
                    });

                    // 更新当前账号的令牌类型（用于后续邮件获取）
                    令牌类型 = permissionResult.token_type;
                    // 注意：不刷新列表UI，避免跳动。用户关闭对话框后会自然看到更新
                }

                // 统一通过后端API调用（后端会根据token_type智能路由）
                const response = await axios.post(`${API_BASE}/api/emails/refresh`, {
                    email_address: this.currentEmail,
                    client_id: client_id,
                    refresh_token: 刷新令牌,
                    folder: this.currentFolder,
                    token_type: 令牌类型 || 'imap',  // 传递令牌类型给后端
                    provider: provider || 'microsoft'
                });

                if (!response.data.success) {
                    // 处理API错误，检查错误类型
                    const errorType = response.data.error_type;
                    const errorMsg = response.data.message || '刷新邮件失败';

                    // 检测需要更新状态的错误类型
                    if (errorType === 'banned' || errorType === 'locked' || errorType === 'expired' || errorType === 'invalid') {
                        try {
                            // 状态映射
                            const statusMap = {
                                'banned': { 刷新令牌: '封禁', 备注: '账号被Microsoft封禁' },
                                'locked': { 刷新令牌: '锁定', 备注: '账号被Microsoft锁定' },
                                'expired': { 刷新令牌: '过期', 备注: '刷新令牌已过期' },
                                'invalid': { 刷新令牌: '无效', 备注: '刷新令牌无效' }
                            };

                            const status = statusMap[errorType];
                            if (status) {
                                await localDB.updateAccount(this.currentEmail, status);

                                // 刷新账号列表
                                await this.loadAccounts();

                                ElMessage.warning({
                                    message: `${errorMsg}，系统已自动标记`,
                                    duration: 3000,
                                    showClose: true
                                });

                                // 关闭邮件对话框
                                this.emailDialogVisible = false;
                            }
                        } catch (updateError) {
                            console.error('更新账号状态失败:', updateError);
                            ElMessage.error(errorMsg);
                        }
                    } else {
                        ElMessage.error(errorMsg);
                    }
                    return;
                }

                // 处理邮件数据
                const emails = response.data.data.map(email => ({
                    id: email.id,
                    邮箱地址: this.currentEmail,
                    subject: email.subject,
                    from_address: email.from_address,
                    from_name: email.from_name,
                    received_time: email.received_time,
                    body_preview: email.body_preview,
                    body: email.body,
                    is_read: email.is_read,
                    folder: this.currentFolder
                }));

                // 不再保存到IndexedDB，直接显示
                this.emails = emails;
                this.filteredEmails = emails;

                ElMessage.success(response.data.message);

            } catch (error) {
                const errorData = error.response?.data || {};
                const errorMsg = errorData.message || error.message || '未知错误';
                const errorType = errorData.error_type;
                console.error('刷新邮件失败:', {
                    status: error.response?.status,
                    error_type: errorType,
                    message: errorMsg
                });

                // 检测账号封禁/锁定状态
                if (errorType === 'banned' || errorType === 'locked') {
                    try {
                        const updates = {
                            刷新令牌: errorType === 'banned' ? '封禁' : '锁定',
                            备注: errorType === 'banned' ? '账号被Microsoft封禁' : '账号被Microsoft锁定'
                        };

                        await localDB.updateAccount(this.currentEmail, updates);

                        // 刷新账号列表
                        await this.loadAccounts();

                        ElMessage.warning({
                            message: errorType === 'banned' ? '账号已被封禁，系统已自动标记' : '账号已被锁定，系统已自动标记',
                            duration: 3000,
                            showClose: true
                        });

                        // 关闭邮件对话框
                        this.emailDialogVisible = false;
                    } catch (updateError) {
                        console.error('更新账号状态失败:', updateError);
                    }
                } else {
                    ElMessage.error('刷新邮件失败: ' + errorMsg);
                }
            } finally {
                this.emailsLoading = false;
            }
        },

        async loadEmailsForFolder() {
            this.emailsLoading = true;
            this.emails = [];
            this.filteredEmails = [];

            try {
                // 从浏览器本地数据库加载邮件
                const emails = await localDB.getEmails(this.currentEmail, this.currentFolder);
                this.emails = emails;
                this.filteredEmails = emails;
            } catch (error) {
                console.error('加载本地邮件失败:', error);
            } finally {
                this.emailsLoading = false;
            }
        },

        filterEmails() {
            const keyword = this.emailSearch.toLowerCase();
            this.filteredEmails = this.emails.filter(email => {
                return (email.subject || '').toLowerCase().includes(keyword) ||
                       (email.from_address || '').toLowerCase().includes(keyword);
            });
        },

        showEmailDetail(email) {
            this.currentEmailDetail = email;
            // 不再需要单独的详情对话框，直接在右侧显示
        },

        adjustIframeHeight() {
            // 调整iframe高度以适应内容
            this.$nextTick(() => {
                const iframe = this.$refs.emailIframe;
                if (!iframe) return;

                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc && iframeDoc.body) {
                        const height = iframeDoc.body.scrollHeight;
                        iframe.style.height = Math.max(height, 500) + 'px';
                    }
                } catch (e) {
                    // 跨域限制，使用默认高度
                    iframe.style.height = '600px';
                }
            });
        },

        renderEmailInIframe() {
            this.adjustIframeHeight();
        },

        // ==================== 工具方法 ====================
        async copyText(text, label) {
            if (!text) {
                ElMessage.warning(`${label}为空`);
                return;
            }

            try {
                await navigator.clipboard.writeText(text);
                ElMessage.success(`${label}已复制到剪贴板`);
            } catch (error) {
                // 降级方案
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                ElMessage.success(`${label}已复制到剪贴板`);
            }
        },

        formatTime(timeStr) {
            if (!timeStr) return '未知';
            try {
                const date = new Date(timeStr);
                return date.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch {
                return timeStr.substring(0, 16);
            }
        },

        // ==================== 数据备份与恢复 ====================
        async exportData() {
            try {
                // 从浏览器本地数据库导出所有数据
                const data = await localDB.exportData();

                // 将账号数据转换为文本格式（与导入格式一致）
                // 格式：邮箱地址----密码----client_id----刷新令牌----令牌过期时间----分组----provider
                const lines = data.accounts.map(rawAccount => {
                    const acc = this.normalizeAccountRecord(rawAccount);
                    return [
                        acc.邮箱地址 || '',
                        acc.密码 || '',
                        acc.client_id || '',
                        acc.刷新令牌 || '',
                        acc.令牌过期时间 || '',
                        acc.分组 || '默认分组',
                        acc.provider || 'microsoft'
                    ].join('----');
                });

                const textContent = lines.join('\n');

                // 生成文本文件
                const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);

                // 创建下载链接
                const link = document.createElement('a');
                link.href = url;
                link.download = `邮箱账号导出_${new Date().toISOString().slice(0,10)}.txt`;
                link.click();

                URL.revokeObjectURL(url);
                ElMessage.success(`导出成功！共 ${data.accounts.length} 个账号`);
            } catch (error) {
                ElMessage.error('导出失败: ' + error.message);
            }
        },

        async importBackup() {
            try {
                const input = document.getElementById('backupFileInput');
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    // 询问是覆盖还是合并
                    const { value } = await ElMessageBox.prompt(
                        '请输入 "覆盖" 来清空现有数据并导入，或输入 "合并" 来合并数据：',
                        '导入备份',
                        {
                            inputPattern: /^(覆盖|合并)$/,
                            inputErrorMessage: '请输入 "覆盖" 或 "合并"',
                            confirmButtonText: '确定',
                            cancelButtonText: '取消'
                        }
                    );

                    const overwrite = value === '覆盖';

                    // 读取JSON文件
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        try {
                            const data = JSON.parse(event.target.result);

                            // 验证数据格式
                            if (!data.accounts || !Array.isArray(data.accounts)) {
                                throw new Error('备份文件格式不正确');
                            }

                            // 导入数据到浏览器本地数据库
                            const result = await localDB.importData(data, overwrite);

                            ElMessage.success(`导入成功！账号: ${result.accounts}, 邮件: ${result.emails}`);

                            // 刷新页面
                            await this.loadGroups();
                            await this.loadAccounts();
                        } catch (error) {
                            ElMessage.error('导入失败: ' + error.message);
                        }
                    };
                    reader.readAsText(file);

                    // 清空input，允许重复选择同一文件
                    input.value = '';
                };

                // 触发文件选择
                input.click();
            } catch (error) {
                // 用户取消
            }
        }
    }
});

app.use(ElementPlus);

// 注册所有Element Plus Icons
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
}

// 挂载应用
app.mount('#app');

