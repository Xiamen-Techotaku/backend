// deploy.js
const express = require("express");
const { exec } = require("child_process");

const app = express();

// 解析 JSON body（GitHub webhook 的 payload）
app.use(express.json());

const PORT = process.env.DEPLOY_PORT || 5001;

// 設定一個密鑰（可選），用來驗證 webhook 是否來自你可信任的來源
const SECRET = process.env.WEBHOOK_SECRET || "your_secret_here";

app.post("/webhook", (req, res) => {
    // 若你有設定密鑰，可在這裡驗證（例如 GitHub HMAC 檢查）
    console.log("Webhook payload:", req.body);
    // 開始更新程序：執行 git pull，然後 reload PM2
    exec("git pull && pm2 reload e-map", (error, stdout, stderr) => {
        if (error) {
            console.error(`部署錯誤: ${error}`);
            return res.status(500).send("部署失敗");
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
        res.send("部署成功"); 
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "伺服器錯誤" });
});

app.listen(PORT, () => {
    console.log(`Webhook server running on port ${PORT}`);
});
