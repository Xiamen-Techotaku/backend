// src/routes/products.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const ensureAdmin = require("../middlewares/admin");

// Cloudinary 配置（使用環境變數，請先在 .env 中設定）
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 使用 memoryStorage 取得檔案 Buffer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 定義上傳圖片至 Cloudinary 的函式
function uploadImageToCloudinary(fileBuffer) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "products" },
            (error, result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(error);
                }
            }
        );
        streamifier.createReadStream(fileBuffer).pipe(uploadStream);
    });
}

// POST /api/products：上架商品 API（未重複，此處略）
router.post("/", ensureAdmin, upload.array("images"), async (req, res, next) => {
    let { name, category_id, price, description } = req.body;
    // 如果 price 有小數點，則做四捨五入處理
    price = Math.round(parseFloat(price));

    let specifications = [];
    let options = [];
    if (req.body.specifications) {
        try {
            specifications = JSON.parse(req.body.specifications);
        } catch (err) {
            return res.status(400).json({ error: "規格格式錯誤" });
        }
    }
    if (req.body.options) {
        try {
            options = JSON.parse(req.body.options);
        } catch (err) {
            return res.status(400).json({ error: "項目格式錯誤" });
        }
    }
    if (!name || !category_id || !price || !description) {
        return res.status(400).json({ error: "請填寫所有必填欄位" });
    }
    try {
        const [result] = await pool.execute(
            `INSERT INTO products (category_id, name, description, price)
             VALUES (?, ?, ?, ?)`,
            [category_id, name, description, price]
        );
        const productId = result.insertId;
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const uploadResult = await uploadImageToCloudinary(file.buffer);
                const imageUrl = uploadResult.secure_url;
                await pool.execute(
                    `INSERT INTO product_images (product_id, image_url)
                     VALUES (?, ?)`,
                    [productId, imageUrl]
                );
            }
        }
        if (specifications.length > 0) {
            for (const spec of specifications) {
                if (!spec.name || spec.price === undefined) continue;
                await pool.execute(
                    `INSERT INTO product_specifications (product_id, name, price)
                     VALUES (?, ?, ?)`,
                    [productId, spec.name, spec.price]
                );
            }
        }
        if (options.length > 0) {
            for (const opt of options) {
                if (!opt.option_name || !opt.option_value) continue;
                await pool.execute(
                    `INSERT INTO product_options (product_id, option_name, option_value)
                     VALUES (?, ?, ?)`,
                    [productId, opt.option_name, opt.option_value]
                );
            }
        }
        res.json({ message: "商品上架成功", productId });
    } catch (err) {
        console.error("上架商品失敗：", err);
        next(err);
    }
});

// GET /api/products：取得商品列表
// 若 query 中有 category_id，則回傳該分類及其子分類的所有商品；否則回傳全部商品
router.get("/", async (req, res, next) => {
    try {
        const { category_id } = req.query;
        let query = `
      SELECT p.*,
        (
          SELECT pi.image_url 
          FROM product_images pi 
          WHERE pi.product_id = p.id 
          ORDER BY pi.sort_order ASC 
          LIMIT 1
        ) AS image_url,
        (
          SELECT CASE 
                   WHEN MIN(ps.price) = MAX(ps.price) THEN CONCAT('$', MIN(ps.price))
                   ELSE CONCAT('$', MIN(ps.price), ' - $', MAX(ps.price))
                 END
          FROM product_specifications ps
          WHERE ps.product_id = p.id
        ) AS spec_price
      FROM products p
    `;
        let params = [];
        if (category_id) {
            // 使用子查詢取得該分類以及其直接子分類的 id
            query +=
                " WHERE p.category_id IN (SELECT id FROM categories WHERE id = ? OR parent_id = ?)";
            params.push(category_id, category_id);
        }
        query += " ORDER BY p.created_at DESC";
        const [rows] = await pool.execute(query, params);
        res.json({ products: rows });
    } catch (err) {
        console.error("拉取商品資料失敗：", err);
        next(err);
    }
});

router.get("/search", async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q || q.trim() === "") {
            return res.json({ products: [] });
        }
        const searchTerm = `%${q}%`;
        const query = `
        SELECT p.*,
          (
            SELECT pi.image_url 
            FROM product_images pi 
            WHERE pi.product_id = p.id 
            ORDER BY pi.sort_order ASC 
            LIMIT 1
          ) AS image_url,
          (
            SELECT CASE 
                     WHEN MIN(ps.price) = MAX(ps.price) THEN CONCAT('$', MIN(ps.price))
                     ELSE CONCAT('$', MIN(ps.price), ' - $', MAX(ps.price))
                   END
            FROM product_specifications ps
            WHERE ps.product_id = p.id
          ) AS spec_price
        FROM products p
        WHERE p.name LIKE ? OR p.description LIKE ?
      `;
        const [rows] = await pool.execute(query, [searchTerm, searchTerm]);
        res.json({ products: rows });
    } catch (err) {
        console.error("搜尋產品失敗：", err);
        next(err);
    }
});

router.get("/random", async (req, res, next) => {
    try {
        // 轉換 limit 為整數，預設 6 筆
        const limit = parseInt(req.query.limit, 10) || 24;
        const query = `
        SELECT 
          products.id,
          products.category_id,
          products.name,
          products.price,
          IFNULL(
            (
              SELECT product_images.image_url
              FROM product_images
              WHERE product_images.product_id = products.id
              ORDER BY product_images.sort_order ASC
              LIMIT 1
            ), ''
          ) AS image_url,
          (
            SELECT CASE 
                     WHEN MIN(product_specifications.price) = MAX(product_specifications.price)
                     THEN CONCAT('$', MIN(product_specifications.price))
                     ELSE CONCAT('$', MIN(product_specifications.price), ' - $', MAX(product_specifications.price))
                   END
            FROM product_specifications
            WHERE product_specifications.product_id = products.id
          ) AS spec_price
        FROM products
        ORDER BY RAND()
        LIMIT ${limit}
      `;
        const [rows] = await pool.execute(query);
        res.json({ products: rows });
    } catch (err) {
        console.error("取得隨機商品資料失敗：", err);
        next(err);
    }
});

// GET /api/products/:id：取得單筆商品詳細資料、所有圖片、規格與項目
router.get("/:id", async (req, res, next) => {
    const productId = req.params.id;
    try {
        const [products] = await pool.execute("SELECT * FROM products WHERE id = ?", [productId]);
        if (products.length === 0) {
            return res.status(404).json({ error: "找不到該商品" });
        }
        const product = products[0];
        const [images] = await pool.execute(
            "SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC",
            [productId]
        );
        product.images = images;
        const [specs] = await pool.execute(
            "SELECT * FROM product_specifications WHERE product_id = ? ORDER BY id",
            [productId]
        );
        product.specifications = specs;
        const [opts] = await pool.execute(
            "SELECT * FROM product_options WHERE product_id = ? ORDER BY id",
            [productId]
        );
        product.options = opts;
        res.json({ product });
    } catch (err) {
        console.error("取得商品詳細資料失敗：", err);
        next(err);
    }
});

// DELETE /api/products/:id：刪除單筆商品
router.delete("/:id", ensureAdmin, async (req, res, next) => {
    const productId = req.params.id;
    try {
        // 刪除商品
        const [result] = await pool.execute("DELETE FROM products WHERE id = ?", [productId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "找不到該商品" });
        }

        res.json({ message: "商品刪除成功" });
    } catch (err) {
        console.error("刪除商品失敗：", err);
        next(err);
    }
});

module.exports = router;
