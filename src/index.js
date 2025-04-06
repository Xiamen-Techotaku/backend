// app.js
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const passport = require("./config/passport");
const path = require("path");
const { createServer: createViteServer } = require("vite");

async function startServer() {
    const app = express();
    const port = process.env.PORT || 4000;

    // --- API 相關中介層 ---
    app.use(
        cors({
            origin: process.env.FRONTEND_URL, // 從 .env 讀取
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            credentials: true,
        })
    );

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 提供靜態檔案（例如上傳檔案）
    app.use("/uploads", express.static("uploads"));

    // 使用 express-session
    app.use(
        session({
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
        })
    );

    // 初始化 Passport
    app.use(passport.initialize());
    app.use(passport.session());

    // --- API Routes ---
    const authRoutes = require("./routes/auth");
    app.use("/api/auth", authRoutes);

    const categoryRoutes = require("./routes/categories");
    app.use("/api/categories", categoryRoutes);

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

    // --- 整合 Vite SSR ---
    // 建立 Vite 伺服器（middleware 模式）
    const vite = await createViteServer({
        server: { middlewareMode: "ssr" },
        appType: "custom", // 表示我們使用自定義 Express 伺服器
    });
    // 使用 Vite 的中介軟體
    app.use(vite.middlewares);

    // Catch-all route: 非 API 路由則進行 SSR 渲染
    app.use("*", async (req, res) => {
        try {
            const url = req.originalUrl;
            // 載入 SSR 入口模組（位於前端 src/entry-server.js）
            const { render } = await vite.ssrLoadModule("/src/entry-server.js");
            // 呼叫 render 函式取得渲染結果
            const { appContent, headTags } = await render(url);

            // 組合完整 HTML，這裡可根據需要加入樣板或其他靜態內容
            const html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            ${headTags}
          </head>
          <body>
            <div id="app">${appContent}</div>
            <script type="module" src="/src/entry-client.js"></script>
          </body>
        </html>
      `;
            res.status(200).set({ "Content-Type": "text/html" }).end(html);
        } catch (err) {
            vite.ssrFixStacktrace(err);
            console.error(err);
            res.status(500).end(err.message);
        }
    });

    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

startServer();
