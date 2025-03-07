// routes/auth.js
const express = require("express");
const router = express.Router();
const passport = require("passport");
const pool = require("../db"); // 資料庫連線模組
const bcrypt = require("bcrypt");
const ensureAdmin = require("../middlewares/admin");

// 新增 require axios 與 qs
const axios = require("axios");
const qs = require("qs");

// ------------------------
// Passport 驗證中介層
// ------------------------
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    return res.status(401).json({ error: "未登入" });
}

// ========================
// 1. 註冊 (Register)
// ========================
router.post("/register", async (req, res, next) => {
    const { name, email, password, confirmPassword } = req.body;

    // 驗證所有必要欄位都有填寫
    if (!name || !email || !password || !confirmPassword) {
        return res.status(400).json({ error: "請填寫所有欄位" });
    }

    // 檢查密碼與確認密碼是否相符
    if (password !== confirmPassword) {
        return res.status(400).json({ error: "密碼與確認密碼不相符" });
    }

    try {
        // 檢查電子信箱是否已存在
        const [rows] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
        if (rows.length > 0) {
            return res.status(400).json({ error: "此電子信箱已註冊" });
        }

        // 密碼雜湊
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 將新使用者資料寫入資料庫
        const [result] = await pool.execute(
            "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
            [name, email, hashedPassword]
        );

        res.json({ message: "註冊成功", userId: result.insertId });
    } catch (err) {
        next(err);
    }
});

// ========================
// 2. 本地登入 (Local Login)
// ========================
router.post("/login", passport.authenticate("local"), (req, res) => {
    res.json({ message: "登入成功", user: req.user });
});

// ========================
// 3. Google 登入 (Google Login)
// ========================
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
        res.redirect("http://localhost:3000");
    }
);

// ========================
// 4. 登出 (Logout)
// ========================
router.get("/logout", (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        res.json({ message: "登出成功" });
    });
});

// ========================
// 5. 取得目前登入使用者 (Get Current User)
// ========================
router.get("/me", (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ user: req.user });
    } else {
        res.status(401).json({ message: "未登入" });
    }
});

// ========================
// 6. 更新個人資料 (Profile)
// ========================
router.put("/profile", ensureAuthenticated, async (req, res, next) => {
    const userId = req.user.id;
    const { name, pickup_name, pickup_phone } = req.body;

    try {
        await pool.execute(
            `
        UPDATE users
        SET name = ?, pickup_name = ?, pickup_phone = ?
        WHERE id = ?
      `,
            [name, pickup_name, pickup_phone, userId]
        );
        const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "找不到使用者" });
        }
        const updatedUser = rows[0];
        delete updatedUser.password;
        res.json({ message: "更新成功", user: updatedUser });
    } catch (err) {
        console.error("更新個人資料失敗：", err);
        next(err);
    }
});

router.get("/admin", ensureAdmin, (req, res) => {
    res.json({ user: req.user });
});

// ========================
// 7. 發送簡訊驗證碼 (Send SMS Verification)
// ========================
router.post("/send-sms", async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ error: "請提供手機號碼" });
    }

    // 檢查上次發送的時間，若不到 60 秒則拒絕
    const now = Date.now();
    if (req.session.lastSMSSent && now - req.session.lastSMSSent < 59000) {
        return res.status(429).json({ error: "請稍後再試" });
    }
    // 記錄這次的請求時間
    req.session.lastSMSSent = now;

    // 產生 6 位數驗證碼
    const smsCode = Math.floor(100000 + Math.random() * 900000);
    // 將驗證碼與手機號碼存入 session，實際專案中建議設定有效期限
    req.session.smsCode = smsCode;
    req.session.smsPhone = phone;

    try {
        const formData = qs.stringify({
            username: process.env.SMS_ACCOUNT,
            password: process.env.SMS_PASSWORD,
            dstaddr: phone,
            smbody: "您的驗證碼為：" + smsCode,
        });
        const response = await axios.post(
            "https://smsb2c.mitake.com.tw/b2c/mtk/SmSend?CharsetURL=UTF8",
            formData,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
            }
        );
        res.json({ message: "驗證碼已發送" });
    } catch (error) {
        console.error("發送簡訊失敗：", error);
        res.status(500).json({ error: "發送簡訊失敗" });
    }
});

// ========================
// 8. 驗證簡訊驗證碼 (Verify SMS Code)
// ========================
router.post("/verify-sms", (req, res) => {
    const { code, phone } = req.body;
    if (!req.session.smsCode || !req.session.smsPhone) {
        return res.status(400).json({ error: "尚未發送驗證碼" });
    }
    if (req.session.smsPhone !== phone) {
        return res.status(400).json({ error: "手機號碼不符合" });
    }
    if (parseInt(code) === req.session.smsCode) {
        // 驗證成功後，可以選擇清除 session 中的驗證碼
        req.session.smsCode = null;
        req.session.smsPhone = null;
        return res.json({ message: "手機驗證成功" });
    } else {
        return res.status(400).json({ error: "驗證碼錯誤" });
    }
});

module.exports = router;
