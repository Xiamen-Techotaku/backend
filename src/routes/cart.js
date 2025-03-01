// routes/cart.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Middleware：確認使用者是否已登入
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated() && req.user && req.user.id) {
        return next();
    }
    return res.status(401).json({ error: "未登入" });
}

/**
 * GET /api/cart
 * 從資料庫中取得當前使用者的購物車項目
 */
router.get("/", ensureAuthenticated, async (req, res, next) => {
    const userId = req.user.id;
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM cart_items WHERE user_id = ? ORDER BY id",
            [userId]
        );
        res.json({ cart: rows });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

/**
 * POST /api/cart
 * 新增商品到購物車
 * 前端需傳入 JSON 格式資料：
 * {
 *    productId: <數字>,
 *    specificationId: <數字 or null>,
 *    options: { 顏色: "紅色", 尺碼: "M", ... },
 *    quantity: <數字>
 * }
 */
router.post("/", ensureAuthenticated, async (req, res, next) => {
    const userId = req.user.id;
    const { productId, specificationId, options, quantity } = req.body;
    if (!productId) {
        return res.status(400).json({ error: "productId 為必填" });
    }
    try {
        // 檢查是否已有相同的購物車項目（使用 <=> 處理 null 比較）
        const [rows] = await pool.execute(
            "SELECT * FROM cart_items WHERE user_id = ? AND product_id = ? AND specification_id <=> ? AND options = ?",
            [userId, productId, specificationId || null, JSON.stringify(options || {})]
        );
        if (rows.length > 0) {
            // 已存在則更新數量
            const existing = rows[0];
            const newQuantity = existing.quantity + (quantity || 1);
            await pool.execute("UPDATE cart_items SET quantity = ? WHERE id = ?", [
                newQuantity,
                existing.id,
            ]);
        } else {
            // 否則插入新的購物車項目
            await pool.execute(
                "INSERT INTO cart_items (user_id, product_id, specification_id, options, quantity) VALUES (?, ?, ?, ?, ?)",
                [
                    userId,
                    productId,
                    specificationId || null,
                    JSON.stringify(options || {}),
                    quantity || 1,
                ]
            );
        }
        // 返回更新後的購物車項目
        const [updatedRows] = await pool.execute(
            "SELECT * FROM cart_items WHERE user_id = ? ORDER BY id",
            [userId]
        );
        res.json({ message: "已加入購物車", cart: updatedRows });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

/**
 * PUT /api/cart/:id
 * 更新指定購物車項目的數量
 * 前端傳入 JSON { quantity: <數字> }
 */
router.put("/:id", ensureAuthenticated, async (req, res, next) => {
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    const { quantity } = req.body;
    try {
        // 檢查該項目是否屬於當前使用者
        const [rows] = await pool.execute("SELECT * FROM cart_items WHERE id = ? AND user_id = ?", [
            id,
            userId,
        ]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "找不到該購物車項目" });
        }
        await pool.execute("UPDATE cart_items SET quantity = ? WHERE id = ?", [quantity, id]);
        const [updatedRows] = await pool.execute(
            "SELECT * FROM cart_items WHERE user_id = ? ORDER BY id",
            [userId]
        );
        res.json({ message: "更新成功", cart: updatedRows });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

/**
 * DELETE /api/cart/:id
 * 刪除指定購物車項目
 */
router.delete("/:id", ensureAuthenticated, async (req, res, next) => {
    const userId = req.user.id;
    const id = parseInt(req.params.id, 10);
    try {
        const [rows] = await pool.execute("SELECT * FROM cart_items WHERE id = ? AND user_id = ?", [
            id,
            userId,
        ]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "找不到該購物車項目" });
        }
        await pool.execute("DELETE FROM cart_items WHERE id = ?", [id]);
        const [updatedRows] = await pool.execute(
            "SELECT * FROM cart_items WHERE user_id = ? ORDER BY id",
            [userId]
        );
        res.json({ message: "已移除購物車項目", cart: updatedRows });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

module.exports = router;
