// src/routes/orders.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const ensureAdmin = require("../middlewares/admin");

// middleware: 確認使用者是否已登入
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.id) {
        return next();
    }
    return res.status(401).json({ error: "未登入" });
}

/**
 * POST /api/orders
 * 建立訂單
 * 前端送入 JSON 格式資料：
 * {
 *    customerName: <字串>,
 *    phone: <字串>,
 *    store: { store_id: <數字或字串>, store_name: <字串> }
 * }
 * 購物車項目則從資料庫中根據使用者 ID 取得（cart_items 表），
 * 並且根據 specification_id 從其他表查詢單價。
 */
router.post("/", ensureAuthenticated, async (req, res, next) => {
    const { customerName, phone, store } = req.body;
    const userId = req.user.id;

    // 驗證手機號碼格式：09開頭的十碼數字
    const phoneRegex = /^09\d{8}$/;
    if (!phoneRegex.test(phone)) {
        return res.status(400).json({ error: "請輸入有效的手機號碼，格式為09開頭的十碼數字" });
    }

    // 取得使用者的購物車項目
    let cartItems;
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM cart_items WHERE user_id = ? ORDER BY id",
            [userId]
        );
        cartItems = rows;
        console.log("Cart items for user", userId, cartItems);
    } catch (err) {
        console.error("取得購物車資料失敗：", err);
        return next(err);
    }

    // 檢查必填欄位
    if (!customerName || !phone || !store || !store.store_id || !store.store_name) {
        return res.status(400).json({ error: "請填寫所有必要欄位 (姓名、電話、超商資訊)" });
    }
    if (cartItems.length === 0) {
        return res.status(400).json({ error: "購物車是空的" });
    }

    try {
        // 1. 寫入 orders 表 (注意：必須包含 user_id)
        const [orderResult] = await pool.execute(
            `INSERT INTO orders (user_id, customer_name, phone, store_id, store_name, store_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, customerName, phone, store.store_id, store.store_name, ""]
        );
        const orderId = orderResult.insertId;
        console.log("訂單建立成功，orderId:", orderId);

        // 2. 依購物車項目寫入 order_items 表
        // 注意：根據新的資料庫設計，order_items 儲存 option_id 而非 options 字串
        for (const item of cartItems) {
            let unitPrice = 0;
            // 若有 specification_id，則從 product_specifications 查詢價格
            if (item.specification_id) {
                const [specRows] = await pool.execute(
                    "SELECT price FROM product_specifications WHERE id = ?",
                    [item.specification_id]
                );
                if (specRows.length > 0) {
                    unitPrice = specRows[0].price;
                } else {
                    console.warn(
                        `找不到 specification_id ${item.specification_id} 的價格，預設為 0`
                    );
                }
            } else {
                // 否則從 products 表查詢基本價格
                const [prodRows] = await pool.execute("SELECT price FROM products WHERE id = ?", [
                    item.product_id,
                ]);
                if (prodRows.length > 0) {
                    unitPrice = prodRows[0].price;
                } else {
                    console.warn(`找不到 product_id ${item.product_id} 的資料，預設價格為 0`);
                }
            }
            // 插入 order_items，使用 item.option_id（已改名）
            await pool.execute(
                `INSERT INTO order_items 
                 (order_id, product_id, specification_id, option_id, quantity, unit_price)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    item.product_id,
                    item.specification_id || null,
                    item.option_id || null,
                    item.quantity,
                    unitPrice,
                ]
            );
            console.log(
                `訂單項目插入：product_id ${item.product_id}, specification_id ${item.specification_id}, option_id ${item.option_id}, quantity ${item.quantity}, unit_price ${unitPrice}`
            );
        }

        // 3. 刪除該使用者的購物車項目
        await pool.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);

        res.json({ message: "訂單建立成功", orderId });
    } catch (err) {
        console.error("建立訂單失敗：", err);
        next(err);
    }
});

// GET /api/orders/my：取得目前登入使用者的訂單列表
router.get("/my", ensureAuthenticated, async (req, res, next) => {
    const userId = req.user.id;
    try {
        const [orders] = await pool.execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
            [userId]
        );
        res.json({ orders });
    } catch (err) {
        console.error("取得我的訂單失敗：", err);
        next(err);
    }
});

/**
 * GET /api/orders/:id
 * 取得單筆訂單詳情及訂單項目
 * 僅允許目前登入的使用者查詢自己的訂單
 * 此處將 order_items 連接 product_specifications 與 product_options，回傳更詳細的規格與選項資訊
 */
router.get("/:id", ensureAuthenticated, async (req, res, next) => {
    const orderId = req.params.id;
    const userId = req.user.id;
    try {
        // 先查詢該訂單
        const [orderRows] = await pool.execute("SELECT * FROM orders WHERE id = ?", [orderId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ error: "找不到訂單" });
        }
        const order = orderRows[0];

        // 如果訂單的 user_id 與當前使用者不同，則需要檢查管理員權限
        if (order.user_id !== userId) {
            if (!req.user.is_admin) {
                return res.status(403).json({ error: "沒有權限查看" });
            }
        }

        // 使用 JOIN 從 product_specifications 與 product_options 表取得詳細資訊
        const [orderItems] = await pool.execute(
            `SELECT 
                oi.*, 
                ps.name AS spec_name, 
                ps.price AS spec_price, 
                po.option_name, 
                po.option_value 
             FROM order_items AS oi
             LEFT JOIN product_specifications AS ps ON oi.specification_id = ps.id
             LEFT JOIN product_options AS po ON oi.option_id = po.id
             WHERE oi.order_id = ?
             ORDER BY oi.id`,
            [orderId]
        );

        res.json({ order, orderItems });
    } catch (err) {
        console.error("取得訂單詳情失敗：", err);
        next(err);
    }
});

module.exports = router;
