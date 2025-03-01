const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const bcrypt = require("bcrypt");
const pool = require("../db"); // 資料庫連線模組

// 設定本地登入策略
passport.use(
    new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
        try {
            const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [email]);
            if (rows.length === 0) {
                return done(null, false, { message: "信箱不存在" });
            }
            const user = rows[0];
            if (!user.password) {
                return done(null, false, { message: "請使用 Google 登入" });
            }
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return done(null, false, { message: "密碼錯誤" });
            }
            await pool.execute("UPDATE users SET last_login = NOW() WHERE id = ?", [user.id]);
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    })
);

// 設定 Google 登入策略
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/api/auth/google/callback",
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const googleId = profile.id;
                const email = profile.emails && profile.emails[0].value;
                const name = profile.displayName;

                const [rows] = await pool.execute("SELECT * FROM users WHERE google_id = ?", [
                    googleId,
                ]);
                if (rows.length > 0) {
                    const user = rows[0];
                    await pool.execute("UPDATE users SET last_login = NOW() WHERE id = ?", [
                        user.id,
                    ]);
                    return done(null, user);
                } else {
                    const [result] = await pool.execute(
                        "INSERT INTO users (name, email, google_id, last_login) VALUES (?, ?, ?, NOW())",
                        [name, email, googleId]
                    );
                    const [newRows] = await pool.execute("SELECT * FROM users WHERE id = ?", [
                        result.insertId,
                    ]);
                    return done(null, newRows[0]);
                }
            } catch (err) {
                return done(err);
            }
        }
    )
);

// 序列化使用者
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// 反序列化使用者
passport.deserializeUser(async (id, done) => {
    try {
        const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [id]);
        if (rows.length === 0) {
            return done(new Error("User not found"));
        }
        done(null, rows[0]);
    } catch (err) {
        done(err);
    }
});

module.exports = passport;
