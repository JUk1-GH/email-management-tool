/**
 * IndexedDB 数据库封装类
 * 用于在浏览器本地存储账号和邮件数据
 * 每个浏览器独立存储，不共享
 */

class LocalDatabase {
    constructor() {
        this.dbName = 'EmailManagementDB';
        this.version = 2;  // 版本升级：添加导入序号索引
        this.db = null;
    }

    /**
     * 初始化数据库
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('❌ 数据库打开失败:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ 浏览器本地数据库初始化成功');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;

                // 创建账号表
                if (!db.objectStoreNames.contains('accounts')) {
                    const accountStore = db.createObjectStore('accounts', { 
                        keyPath: '邮箱地址' 
                    });
                    accountStore.createIndex('分组', '分组', { unique: false });
                    accountStore.createIndex('刷新令牌', '刷新令牌', { unique: false });
                    accountStore.createIndex('导入序号', '导入序号', { unique: false });
                    console.log('✅ 创建 accounts 表');
                } else {
                    // 数据库升级：为已存在的表添加新索引
                    const accountStore = transaction.objectStore('accounts');
                    if (!accountStore.indexNames.contains('导入序号')) {
                        accountStore.createIndex('导入序号', '导入序号', { unique: false });
                        console.log('✅ 添加导入序号索引');
                    }
                }

                // 创建邮件表
                if (!db.objectStoreNames.contains('emails')) {
                    const emailStore = db.createObjectStore('emails', { 
                        keyPath: 'id',
                        autoIncrement: true 
                    });
                    emailStore.createIndex('邮箱地址', '邮箱地址', { unique: false });
                    emailStore.createIndex('folder', 'folder', { unique: false });
                    emailStore.createIndex('邮箱_文件夹', ['邮箱地址', 'folder'], { unique: false });
                    console.log('✅ 创建 emails 表');
                }
            };
        });
    }

    /**
     * 获取所有账号（按导入序号排序）
     */
    async getAllAccounts() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const request = store.getAll();

            request.onsuccess = () => {
                const accounts = request.result || [];
                // 按导入序号排序（保持导入文件的原始顺序）
                accounts.sort((a, b) => {
                    const seqA = a.导入序号 || 0;
                    const seqB = b.导入序号 || 0;
                    return seqA - seqB;
                });
                resolve(accounts);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 添加账号（支持批量）
     * 自动为每个账号分配导入序号，保持文件原始顺序
     */
    async addAccounts(accounts) {
        return new Promise(async (resolve, reject) => {
            // 获取当前最大的导入序号
            const existingAccounts = await this.getAllAccounts();
            let maxSeq = 0;
            existingAccounts.forEach(acc => {
                if (acc.导入序号 && acc.导入序号 > maxSeq) {
                    maxSeq = acc.导入序号;
                }
            });

            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');
            let successCount = 0;
            let errorCount = 0;

            // 为每个账号分配递增的导入序号
            accounts.forEach((account, index) => {
                // 如果账号没有导入序号，则分配一个
                if (!account.导入序号) {
                    account.导入序号 = maxSeq + index + 1;
                }

                // 初始化权限相关字段
                if (account.令牌类型 === undefined) {
                    account.令牌类型 = null;  // null=未检测, 'graph'/'o2'/'imap'
                }
                if (account.权限已检测 === undefined) {
                    account.权限已检测 = false;
                }
                if (account.使用本地IP === undefined) {
                    account.使用本地IP = false;
                }

                const request = store.put(account);
                request.onsuccess = () => successCount++;
                request.onerror = () => errorCount++;
            });

            transaction.oncomplete = () => {
                resolve({ success: successCount, error: errorCount });
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 删除账号
     */
    async deleteAccount(email) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts', 'emails'], 'readwrite');
            
            // 删除账号
            const accountStore = transaction.objectStore('accounts');
            accountStore.delete(email);

            // 删除该账号的所有邮件
            const emailStore = transaction.objectStore('emails');
            const index = emailStore.index('邮箱地址');
            const request = index.openCursor(IDBKeyRange.only(email));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 批量删除账号
     */
    async batchDeleteAccounts(emails) {
        const promises = emails.map(email => this.deleteAccount(email));
        return Promise.all(promises);
    }

    /**
     * 更新账号分组
     */
    async updateAccountGroup(email, groupName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');
            const request = store.get(email);

            request.onsuccess = () => {
                const account = request.result;
                if (account) {
                    account.分组 = groupName;
                    store.put(account);
                }
            };

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 批量更新分组
     */
    async batchUpdateGroup(emails, groupName) {
        const promises = emails.map(email => this.updateAccountGroup(email, groupName));
        const results = await Promise.all(promises);
        const successCount = results.filter(r => r === true).length;
        return {
            success: successCount,
            failed: results.length - successCount
        };
    }

    /**
     * 获取所有分组（去重）
     */
    async getAllGroups() {
        const accounts = await this.getAllAccounts();
        const groups = [...new Set(accounts.map(acc => acc.分组 || '默认分组'))];
        return groups.sort();
    }

    /**
     * 获取分组账号数量
     */
    async getGroupCounts() {
        const accounts = await this.getAllAccounts();
        const counts = {};
        accounts.forEach(acc => {
            const group = acc.分组 || '默认分组';
            counts[group] = (counts[group] || 0) + 1;
        });
        return counts;
    }

    /**
     * 删除分组（将账号设为默认分组）
     */
    async deleteGroup(groupName) {
        const accounts = await this.getAllAccounts();
        const affectedAccounts = accounts.filter(acc => acc.分组 === groupName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');

            affectedAccounts.forEach(account => {
                account.分组 = '默认分组';
                store.put(account);
            });

            transaction.oncomplete = () => resolve(affectedAccounts.length);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 获取单个账号
     */
    async getAccount(email) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readonly');
            const store = transaction.objectStore('accounts');
            const request = store.get(email);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 更新账号（用于标记封禁等）
     */
    async updateAccount(email, updates) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');
            const request = store.get(email);

            request.onsuccess = () => {
                const account = request.result;
                if (account) {
                    Object.assign(account, updates);
                    store.put(account);
                }
            };

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 更新账号权限信息
     */
    async updateAccountPermission(email, permissionData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts'], 'readwrite');
            const store = transaction.objectStore('accounts');
            const request = store.get(email);

            request.onsuccess = () => {
                const account = request.result;
                if (account) {
                    account.令牌类型 = permissionData.token_type;
                    account.使用本地IP = permissionData.use_local_ip;
                    account.权限已检测 = true;
                    store.put(account);
                }
            };

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 保存邮件（批量）
     */
    async saveEmails(emails) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['emails'], 'readwrite');
            const store = transaction.objectStore('emails');
            let count = 0;

            emails.forEach(email => {
                const request = store.put(email);
                request.onsuccess = () => count++;
            });

            transaction.oncomplete = () => resolve(count);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 获取邮件列表
     */
    async getEmails(email, folder = 'inbox', limit = 100) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['emails'], 'readonly');
            const store = transaction.objectStore('emails');
            const index = store.index('邮箱_文件夹');
            const request = index.getAll([email, folder]);

            request.onsuccess = () => {
                const results = request.result || [];
                // 按时间倒序排列
                results.sort((a, b) => new Date(b.received_time) - new Date(a.received_time));
                resolve(results.slice(0, limit));
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清空所有数据
     */
    async clearAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['accounts', 'emails'], 'readwrite');
            
            transaction.objectStore('accounts').clear();
            transaction.objectStore('emails').clear();

            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * 导出所有数据为JSON
     */
    async exportData() {
        const accounts = await this.getAllAccounts();
        const emailsStore = this.db.transaction(['emails'], 'readonly').objectStore('emails');
        const emails = await new Promise((resolve, reject) => {
            const request = emailsStore.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });

        return {
            version: 1,
            exportTime: new Date().toISOString(),
            accounts,
            emails
        };
    }

    /**
     * 从JSON导入数据
     */
    async importData(data, overwrite = false) {
        if (overwrite) {
            await this.clearAll();
        }

        const transaction = this.db.transaction(['accounts', 'emails'], 'readwrite');
        const accountStore = transaction.objectStore('accounts');
        const emailStore = transaction.objectStore('emails');

        // 导入账号
        data.accounts.forEach(account => {
            accountStore.put(account);
        });

        // 导入邮件
        data.emails.forEach(email => {
            emailStore.put(email);
        });

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve({
                accounts: data.accounts.length,
                emails: data.emails.length
            });
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

// 创建全局数据库实例
const localDB = new LocalDatabase();

