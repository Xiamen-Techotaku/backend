// src/routes/waaship.js
const express = require("express");
const router = express.Router();

// 接收 Waaship Callback (POST 方式)
router.post("/waaship-callback", (req, res) => {
    console.log("收到 POST Callback 資料：", req.body);
    const storeData = req.body; // 例如 { store_id, store_name, ... }

    // 回傳的 HTML 中，延遲 500 毫秒後關閉 popup
    res.send(`
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>
        <script>
          window.opener.postMessage(${JSON.stringify(storeData)}, "*");
          setTimeout(function(){
            window.close();
          }, 500);
        </script>
      </body>
    </html>
  `);
});

module.exports = router;
