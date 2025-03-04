// app.js
require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 4000;
const session = require("express-session");
const cors = require("cors");
const passport = require("./config/passport"); // 載入我們的 passport 設定

// 啟用 CORS
app.use(
    cors({
        origin: process.env.FRONTEND_URL, // 會從 .env 中讀取
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
    })
);

// 解析 JSON 請求
app.use(express.json());

// 解析 URL-encoded 資料（如果需要）
app.use(express.urlencoded({ extended: true }));

// 設定靜態檔案目錄，讓 /uploads 路徑可以存取 uploads 資料夾內的檔案
app.use("/uploads", express.static("uploads"));

// 使用 Express Session
app.use(
    session({
        secret: process.env.SESSION_SECRET, // 請使用一個強密鑰
        resave: false,
        saveUninitialized: false,
    })
);

// 初始化 Passport 並使用 Session
app.use(passport.initialize());
app.use(passport.session());

// 使用 Auth 路由
const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

const categoryRoutes = require("./routes/categories");
app.use("/api/categories", categoryRoutes);

// 載入產品路由
const productRoutes = require("./routes/products");
app.use("/api/products", productRoutes);

const cartRoutes = require("./routes/cart");
app.use("/api/cart", cartRoutes);

const ordersRoutes = require("./routes/orders");
app.use("/api/orders", ordersRoutes);

const retailRoutes = require("./routes/retail");
app.use("/api/retail", retailRoutes);

const collectRoutes = require("./routes/collect");
app.use("/api/collect", collectRoutes);

const adminRoutes = require("./routes/admin");
app.use("/api/admin", adminRoutes);

const reviewsRouter = require("./routes/reviews");
app.use("/api/reviews", reviewsRouter);

// 測試根路由
app.get("/", (req, res) => {
    res.send("Hello, this is the backend API for ShopName.");
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
