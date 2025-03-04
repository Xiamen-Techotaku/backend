// src/routes/collect.js
const express = require("express");
const router = express.Router();
const https = require("https");
const pool = require("../db"); // 資料庫連線模組
const OpenCC = require("opencc-js"); // 載入 opencc-js 插件
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

// 共用的 HTTPS GET 請求，回傳 Promise
function fetchData(apiUrl) {
    return new Promise((resolve, reject) => {
        https
            .get(apiUrl, (resp) => {
                let data = "";
                resp.on("data", (chunk) => {
                    data += chunk;
                });
                resp.on("end", () => {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (e) {
                        reject(new Error("解析 API 回傳資料失敗"));
                    }
                });
            })
            .on("error", (err) => {
                reject(err);
            });
    });
}

/**
 * 通用採集流程
 * @param {string} productLink 前端傳入的產品連結
 * @param {RegExp} regex 用來從連結中提取 num_iid 的正則表達式
 * @param {function} apiUrlBuilder 組裝 API URL 的函式，參數為 (key, secret, num_iid)
 */
async function collectProduct(productLink, regex, apiUrlBuilder) {
    const parsedUrl = new URL(productLink);
    const match = parsedUrl.pathname.match(regex);
    if (!match) {
        throw new Error("無法從連結中提取 num_iid");
    }
    const num_iid = match[1];
    const key = process.env.COLLECT_KEY;
    const secret = process.env.COLLECT_SECRET;
    if (!key || !secret) {
        throw new Error("未配置 API key/secret");
    }
    const apiUrl = apiUrlBuilder(key, secret, num_iid);
    const data = await fetchData(apiUrl);
    return convertSimplifiedToTraditional(data);
}

// 1688 採集接口
router.post("/1688", ensureAdmin, async (req, res, next) => {
    const productLink = req.body.link;
    if (!productLink) {
        return res.status(400).json({ error: "請提供產品連結" });
    }
    try {
        const data = await collectProduct(
            productLink,
            /offer\/(\d+)\.html/,
            (key, secret, num_iid) =>
                `https://api-gw.onebound.cn/1688/item_get/?key=${key}&secret=${secret}&num_iid=${num_iid}&agent=1&lang=zh-TW`
        );
        res.json({ data });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: e.message });
    }
});

// 京東 採集接口
router.post("/jd", ensureAdmin, async (req, res, next) => {
    const productLink = req.body.link;
    if (!productLink) {
        return res.status(400).json({ error: "請提供產品連結" });
    }
    try {
        const data = await collectProduct(
            productLink,
            /\/(\d+)\.html/,
            (key, secret, num_iid) =>
                `https://api-gw.onebound.cn/jd/item_get/?key=${key}&secret=${secret}&num_iid=${num_iid}&domain_type=jd&lang=zh-CN`
        );
        res.json({ data });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: e.message });
    }
});

// 上傳產品資料接口（直接處理 URL，不進行檔案上傳）
router.post("/upload", async (req, res, next) => {
    let { name, category_id, price, description, image_url, images, specifications, options } =
        req.body;
    // 僅要求必填欄位：名稱、分類與價格
    if (!name || !category_id || !price) {
        console.log("請填寫必填欄位：名稱、分類、價格");
        return res.status(400).json({ error: "請填寫必填欄位：名稱、分類、價格" });
    }
    // 如果沒有描述，預設為空字串
    description = description || "";

    try {
        // 進行簡轉繁處理
        name = converter(name);
        description = converter(description);

        if (specifications && Array.isArray(specifications)) {
            specifications = specifications.map((spec) => {
                if (spec.name) {
                    spec.name = converter(spec.name);
                }
                return spec;
            });
        }

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

        // 插入 products 表
        const [result] = await pool.execute(
            `INSERT INTO products (category_id, name, description, price)
             VALUES (?, ?, ?, ?)`,
            [category_id, name, description, price]
        );
        const productId = result.insertId;

        // 插入主圖片及圖片集合到 product_images 表
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
