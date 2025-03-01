// routes/categories.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const ensureAdmin = require("../middlewares/admin");

// =============================
// 1. 取得所有分類資料
// =============================
router.get("/", async (req, res, next) => {
    try {
        const [rows] = await pool.execute("SELECT * FROM categories ORDER BY id");
        res.json({ categories: rows });
    } catch (err) {
        console.error("取得分類資料失敗：", err);
        next(err);
    }
});

// =============================
// 2. 新增分類
// =============================
router.post("/", ensureAdmin, async (req, res, next) => {
    const { name, description, parent_id } = req.body;

    // name 為必填欄位
    if (!name) {
        return res.status(400).json({ error: "分類名稱是必填的" });
    }

    try {
        // 如果沒有傳入 parent_id 或是空字串，就存入 NULL
        const parentId = parent_id ? parent_id : null;
        const [result] = await pool.execute(
            "INSERT INTO categories (name, description, parent_id) VALUES (?, ?, ?)",
            [name, description, parentId]
        );
        res.json({ message: "新增分類成功", categoryId: result.insertId });
    } catch (err) {
        console.error("新增分類失敗：", err);
        next(err);
    }
});

// =============================
// 3. 更新指定分類
// =============================
router.put("/:id", ensureAdmin, async (req, res, next) => {
    const { id } = req.params;
    const { name, description, parent_id } = req.body;

    if (!name) {
        return res.status(400).json({ error: "分類名稱是必填的" });
    }

    try {
        const parentId = parent_id ? parent_id : null;
        const [result] = await pool.execute(
            "UPDATE categories SET name = ?, description = ?, parent_id = ? WHERE id = ?",
            [name, description, parentId, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "找不到指定的分類" });
        }

        res.json({ message: "分類更新成功" });
    } catch (err) {
        console.error("更新分類失敗：", err);
        next(err);
    }
});

module.exports = router;
