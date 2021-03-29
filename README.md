- [Install](#sec-1)
- [Usage](#sec-2)
- [Notes](#sec-3)


# Install<a id="sec-1"></a>

```sh
npm install express-oracle-session-ts
```

# Usage<a id="sec-2"></a>

```js
import express from "express";
import eos from "express-oracle-session-ts";
import session from "express-session";

const OracleSessionStore = eos(session);

const sessionStore = new OracleSessionStore({
  user: ORACLE.user,
  password: ORACLE.password,
  connectionString: ORACLE.conStr,
  schema: {
    tableName: "tbl_cloud_session",
  },
});

// Create Express server
const app = express();

app.use(
  session({
    resave: true,
    saveUninitialized: true,
    secret: SESSION_SECRET,
    store: sessionStore,
  })
);
```

# Notes<a id="sec-3"></a>

-   this module was largely a port of [express-oracle-session](https://github.com/Slumber86/express-oracle-session) to typescript because at that time express-oracle-session failed to work with node oracle 5. But it seems that it has been updated recently probably to address this issue.
-   works with lastest node oracle (5+).
-   will create new table if the current session table doesn't not exist.
-   querying oracle DB, if failed, this module will retry three times. If it can't get the connection it will throw an error and exit the app (`process.exit(1)`).
