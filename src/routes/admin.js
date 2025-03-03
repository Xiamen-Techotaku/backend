// src/routes/admin.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const ensureAdmin = require("../middlewares/admin");

// 取得目前登入管理員的資訊（管理員專用）
router.get("/me", ensureAdmin, (req, res) => {
    res.json({ user: req.user });
});

// 取得所有訂單（管理員專用）
router.get("/orders", ensureAdmin, async (req, res, next) => {
    try {
        const [orders] = await pool.execute("SELECT * FROM orders ORDER BY created_at DESC");
        res.json({ orders });
    } catch (err) {
        console.error("管理員取得所有訂單失敗：", err);
        next(err);
    }
});

// 更新訂單狀態（管理員專用）
// 預期狀態：pending、processing、completed、cancelled
router.put("/orders/:id/status", ensureAdmin, async (req, res, next) => {
    const orderId = req.params.id;
    const { order_status } = req.body;
    if (!order_status) {
        return res.status(400).json({ error: "缺少訂單狀態" });
    }
    try {
        await pool.execute("UPDATE orders SET order_status = ? WHERE id = ?", [
            order_status,
            orderId,
        ]);
        res.json({ message: "訂單狀態更新成功" });
    } catch (err) {
        console.error("更新訂單狀態失敗：", err);
        next(err);
    }
});

// PUT /api/admin/orders/:id/tracking
router.put("/orders/:id/tracking", ensureAdmin, async (req, res, next) => {
    const orderId = req.params.id;
    const { tracking_number } = req.body;
    if (!tracking_number) {
        return res.status(400).json({ error: "缺少貨運單號" });
    }
    try {
        await pool.execute("UPDATE orders SET tracking_number = ? WHERE id = ?", [
            tracking_number,
            orderId,
        ]);
        res.json({ message: "貨運單號更新成功" });
    } catch (err) {
        console.error("更新貨運單號失敗：", err);
        next(err);
    }
});

module.exports = router;
