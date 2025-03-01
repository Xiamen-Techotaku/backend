// src/routes/collect.js
const express = require("express");
const router = express.Router();
const https = require("https");
const pool = require("../db"); // 資料庫連線模組
const OpenCC = require("opencc-js"); // 載入 opencc-js 插鍵
const ensureAdmin = require("../middlewares/admin");

// 建立簡轉繁轉換器：從簡體（cn）轉為繁體（tw）
const converter = OpenCC.Converter({ from: "cn", to: "tw" });

// 遞迴函式：轉換所有字串欄位
function convertSimplifiedToTraditional(data) {
    if (typeof data === "string") {
        return converter(data);
    } else if (Array.isArray(data)) {
        return data.map(convertSimplifiedToTraditional);
    } else if (typeof data === "object" && data !== null) {
        const newObj = {};
        for (const key in data) {
            if (Object.hasOwnProperty.call(data, key)) {
                newObj[key] = convertSimplifiedToTraditional(data[key]);
            }
        }
        return newObj;
    }
    return data;
}

// 採集 1688 產品資料接口
router.post("/1688", ensureAdmin, async (req, res, next) => {
    const productLink = req.body.link;
    if (!productLink) {
        return res.status(400).json({ error: "請提供產品連結" });
    }
    try {
        const parsedUrl = new URL(productLink);
        const match = parsedUrl.pathname.match(/offer\/(\d+)\.html/);
        if (!match) {
            return res.status(400).json({ error: "無法從連結中提取 num_iid" });
        }
        const num_iid = match[1];
        const key = process.env.COLLECT_1688_KEY;
        const secret = process.env.COLLECT_1688_SECRET;
        if (!key || !secret) {
            return res.status(500).json({ error: "未配置 1688 API key/secret" });
        }
        const apiUrl = `https://api-gw.onebound.cn/1688/item_get/?key=${key}&secret=${secret}&num_iid=${num_iid}&agent=1&lang=zh-TW`;

        https
            .get(apiUrl, (resp) => {
                let data = "";
                resp.on("data", (chunk) => {
                    data += chunk;
                });
                resp.on("end", () => {
                    try {
                        const jsonData = JSON.parse(data);
                        // 將從 1688 取得的簡體資料轉換成繁體
                        const convertedData = convertSimplifiedToTraditional(jsonData);
                        res.json({ data: convertedData });
                    } catch (e) {
                        res.status(500).json({ error: "解析 API 回傳資料失敗" });
                    }
                });
            })
            .on("error", (err) => {
                console.error("Error: " + err.message);
                res.status(500).json({ error: err.message });
            });
    } catch (e) {
        console.error(e);
        return res.status(400).json({ error: "連結格式錯誤" });
    }
});

// 上傳產品資料接口（改為直接處理 URL，不進行檔案上傳）
router.post("/upload", async (req, res, next) => {
    // 從前端傳入的資料，格式例如：
    // {
    //   name: "...",
    //   category_id: "...",
    //   price: "...",
    //   description: "...",
    //   image_url: "...",         // 主圖片URL
    //   images: [{ image_url: "..." }, ...],
    //   specifications: [{ name: "...", price: "..." }, ...],
    //   options: [{ option_name: "...", option_value: "..." }, ...]
    // }
    let { name, category_id, price, description, image_url, images, specifications, options } =
        req.body;
    if (!name || !category_id || !price || !description) {
        return res.status(400).json({ error: "請填寫所有必填欄位" });
    }

    try {
        // 對主要文字欄位進行簡轉繁處理
        name = converter(name);
        description = converter(description);

        // 若有規格，轉換每個規格的名稱
        if (specifications && Array.isArray(specifications)) {
            specifications = specifications.map((spec) => {
                if (spec.name) {
                    spec.name = converter(spec.name);
                }
                return spec;
            });
        }

        // 若有選項，轉換選項名稱及值
        if (options && Array.isArray(options)) {
            options = options.map((opt) => {
                if (opt.option_name) {
                    opt.option_name = converter(opt.option_name);
                }
                if (opt.option_value) {
                    opt.option_value = converter(opt.option_value);
                }
                return opt;
            });
        }

        // 將基本資料插入 products 表
        // 此處不再寫入 image_url 欄位（假設 products 表沒有此欄位），
        // 主圖片可儲存在 product_images 表中
        const [result] = await pool.execute(
            `INSERT INTO products (category_id, name, description, price)
       VALUES (?, ?, ?, ?)`,
            [category_id, name, description, price]
        );
        const productId = result.insertId;

        // 插入主圖片及圖片集合到 product_images 表
        // 假設前端傳入的 images 陣列中，每個物件皆有 image_url 屬性
        if (images && Array.isArray(images)) {
            for (const imgObj of images) {
                await pool.execute(
                    `INSERT INTO product_images (product_id, image_url)
           VALUES (?, ?)`,
                    [productId, imgObj.image_url]
                );
            }
        }

        // 插入規格到 product_specifications 表
        if (specifications && Array.isArray(specifications)) {
            for (const spec of specifications) {
                if (!spec.name || spec.price === undefined) continue;
                await pool.execute(
                    `INSERT INTO product_specifications (product_id, name, price)
           VALUES (?, ?, ?)`,
                    [productId, spec.name, spec.price]
                );
            }
        }

        // 插入選項到 product_options 表
        if (options && Array.isArray(options)) {
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

module.exports = router;
