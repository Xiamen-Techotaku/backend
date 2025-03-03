// src/routes/reviews.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const ensureAdmin = require("../middlewares/admin");

// 新增評論（管理員才能新增）
// POST /api/reviews
router.get("/", async (req, res, next) => {
    const productId = req.query.product_id;
    if (!productId) {
        return res.status(400).json({ error: "請提供 product_id" });
    }
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC",
            [productId]
        );
        res.json({ reviews: rows });
    } catch (err) {
        console.error("取得評論失敗：", err);
        next(err);
    }
});

router.post("/", ensureAdmin, async (req, res, next) => {
    const { product_id, reviewer_name, content, rating } = req.body;

    // 檢查必要欄位是否存在
    if (!product_id || !content || typeof rating === "undefined") {
        return res.status(400).json({ error: "缺少必要的欄位：product_id、content、rating" });
    }

    // 檢查評分是否在 1 到 5 分之間
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: "評分必須介於 1 到 5 分之間" });
    }

    try {
        await pool.execute(
            "INSERT INTO reviews (product_id, reviewer_name, content, rating) VALUES (?, ?, ?, ?)",
            [product_id, reviewer_name || null, content, rating]
        );
        res.status(201).json({ message: "評論送出成功" });
    } catch (err) {
        console.error("送出評論失敗：", err);
        next(err);
    }
});

module.exports = router;
