window.JEMAIL_CONFIG = Object.assign(
    {
        // 留空时默认调用当前 origin。
        // 如果前后端分离部署，请手动填写 API_BASE。
        API_BASE: "",
    },
    window.JEMAIL_CONFIG || {}
);
