import oracledb from "oracledb";
// import { Store } from "express-session";
import { Store } from "express-session";

interface StoreOptions extends oracledb.PoolAttributes {
  checkExpirationInterval: number;
  expiration: number;
  createDatabaseTable: boolean;
  schema: {
    tableName: string;
    columnNames: {
      session_id: string;
      expires: string;
      data: string;
    };
  };
}
const defaultOptions: StoreOptions = {
  checkExpirationInterval: 900000, // How frequently expired sessions will be cleared; milliseconds.
  expiration: 86400000, // The maximum age of a valid session; milliseconds.
  createDatabaseTable: true, // Whether or not to create the sessions database table, if one does not already exist.
  schema: {
    tableName: "sessions",
    columnNames: {
      /* eslint-disable @typescript-eslint/camelcase */
      session_id: "session_id",
      expires: "expires",
      data: "attributes",
    },
  },
};

interface SessionInstance {
  Store: any;
}

function isObject(a: any): boolean {
  const type = typeof a;
  return type === "function" || type === "object" && !!a;
} 
function deepcopy<T>(a: T, b: Partial<T>): T {
  if (!isObject(a)) {
    return a;
  }
  for (const key in a) {
    if (b[key] === undefined) {
      b[key] = a[key];
    }
    b[key] = deepcopy<T[Extract<keyof T, string>]>(a[key], b[key] as any);
  }
  return b as T;
}

const store = (session: SessionInstance) => {
  class OracleSessionStore extends session.Store {
    options: StoreOptions;
    pool: Promise<oracledb.Pool>;
    _expirationInterval = 0;
    constructor(options: Partial<StoreOptions>) {
      super(options);
      // doing deep copy to options
      this.options = deepcopy(defaultOptions, options);
      // create oracle pool
      this.pool = this.createNewPool();
      if (this.options.createDatabaseTable) {
        this.createDatabaseTable().then(() => {
			    this.setExpirationInterval();
        });
      } else {
        this.setExpirationInterval();
      }
    }

    createNewPool() {
      return oracledb.createPool(this.options).catch(error => {
        console.error(error, "express-oracle-session-ts: db pool is failed to initialized, app will exit with code 1");
        process.exit(1);
      });
    }

    getCon(activePool: Promise<oracledb.Pool>, tryCount: number): Promise<oracledb.Connection> {
      return activePool.then(mypool =>
        mypool.getConnection().catch(error => {
          console.error(error, `cannot get connection number of tries left: ${tryCount}`);
          // close the pool
          mypool.close(10);

          // if we have tried enough times
          if (tryCount === 0) {
            console.log("Give up trying new pool, EOST is exiting with code 1");
            return process.exit(1);
          }

          // create new pool promise
          this.pool = this.createNewPool();

          return this.getCon(this.pool, tryCount - 1);
        })
      );
    }

    getOraConn() {
      return this.getCon(this.pool, 3);
    }

    async createDatabaseTable() {
      const sql = `CREATE TABLE ${this.options.schema.tableName} (
${this.options.schema.columnNames.session_id} VARCHAR(128)  NOT NULL,
${this.options.schema.columnNames.expires} NUMBER(11) NOT NULL,
${this.options.schema.columnNames.data} CLOB,
PRIMARY KEY (${this.options.schema.columnNames.session_id})
)`;
      let conn;
      try {
        conn = await this.getOraConn();
        await conn.execute(sql);
      } catch (error) {
        if (error.message.substring(0, 9) === "ORA-00955") {
          console.log("EOST: Table already exists");
          return;
        }
        console.error("Failed to create sessions database table.");
        console.error(error);
      } finally {
        if (conn) {
          conn.close();
        }
      }
    }

    get(sid: string, cb: (err: any, session?: Express.SessionData | null) => void) {
      const sql = `SELECT ${this.options.schema.columnNames.data} AS data FROM ${this.options.schema.tableName} WHERE ${this.options.schema.columnNames.session_id} = :sessionid AND ROWNUM = 1`;

      const params = { sessionid: sid };

      this.getOraConn().then(conn => {
        conn
          .execute<string>(
            sql,
            params,
            { fetchInfo: { DATA: { type: oracledb.STRING } } } // Fetch as a String instead of a Stream
          )
          .then(result => {
            let session = null;
            try {
              session = result?.rows && result?.rows[0] ? JSON.parse(result?.rows[0][0]) : null;
            } catch (error) {
              return cb(new Error("Failed to parse data for session: " + sid));
            }
            cb(null, session);
          })
          .finally(() => conn.close());
      });
    }

    set(sid: string, data: Express.SessionData, cb?: (err?: any) => void): void {
      let expires;

      if (data.cookie) {
        if (data.cookie.expires) {
          expires = data.cookie.expires;
        }
      }

      if (!expires) {
        expires = Date.now() + this.options.expiration;
      }

      if (!(expires instanceof Date)) {
        expires = new Date(expires as number);
      }

      // Use whole seconds here; not milliseconds.
      expires = Math.round(expires.getTime() / 1000);

      const jsondata = JSON.stringify(data);

      const sql = `MERGE INTO ${this.options.schema.tableName} trg
USING (SELECT :sessionid as ${this.options.schema.columnNames.session_id} FROM DUAL) src
ON (trg.${this.options.schema.columnNames.session_id} = src.${this.options.schema.columnNames.session_id})
WHEN MATCHED THEN UPDATE
SET trg.${this.options.schema.columnNames.expires} = :expires,
trg.${this.options.schema.columnNames.data} = :attributes
WHEN NOT MATCHED THEN INSERT (${this.options.schema.columnNames.session_id}, ${this.options.schema.columnNames.expires}, ${this.options.schema.columnNames.data})
VALUES (:sessionid,:expires,:attributes)`;

      const params = {
        sessionid: sid,
        expires: expires,
        attributes: jsondata,
      };

      this.getOraConn().then(conn => {
        conn
          .execute<string>(sql, params, { autoCommit: true })
          .then(() => {
            cb && cb();
          })
          .catch(error => {
            return cb && cb(error);
          })
          .finally(() => conn.close());
      });
    }

    touch(sid: string, data: Express.SessionData, cb?: (err?: any) => void): void {
      let expires;

      if (data.cookie) {
        if (data.cookie.expires) {
          expires = data.cookie.expires;
        }
      }

      if (!expires) {
        expires = Date.now() + this.options.expiration;
      }

      if (!(expires instanceof Date)) {
        expires = new Date(expires as number);
      }

      // Use whole seconds here; not milliseconds.
      expires = Math.round(expires.getTime() / 1000);

      const sql = `UPDATE ${this.options.schema.tableName} SET ${this.options.schema.columnNames.expires} = :expires WHERE ${this.options.schema.columnNames.session_id} = :sessionid`;
      const params = {
        expires: expires,
        sessionid: sid,
      };

      this.getOraConn().then(conn => {
        conn
          .execute<string>(sql, params, { autoCommit: true })
          .then(() => {
            cb && cb();
          })
          .catch(error => {
            return cb && cb(error);
          })
          .finally(() => conn.close());
      });
    }

    destroy(sid: string, cb?: (err?: any) => void) {
      const sql = `DELETE FROM ${this.options.schema.tableName} WHERE ${this.options.schema.columnNames.session_id} = :sessionid`;
      const params = {
        sessionid: sid,
      };
      this.getOraConn().then(conn => {
        conn
          .execute(sql, params, { autoCommit: true })
          .then(() => {
            cb && cb();
          })
          .catch(error => {
            cb && cb(error);
          })
          .finally(() => conn.close());
      });
    }

    length(cb: (err: any, length?: number | null) => void) {
      const sql = `SELECT COUNT(*) FROM ${this.options.schema.tableName}`;
      this.getOraConn().then(conn => {
        conn
          .execute<number[]>(sql)
          .then(result => {
            const count = result.rows && result.rows[0] ? result.rows[0][0] : 0;
            cb(null, count);
          })
          .catch(error => {
            cb(error);
          })
          .finally(() => conn.close());
      });
    }

    clear(cb?: (err?: any) => void): void {
      const sql = `DELETE FROM ${this.options.schema.tableName}`;

      this.getOraConn().then(conn => {
        conn
          .execute(sql)
          .then(() => {
            cb && cb();
          })
          .catch(error => {
            cb && cb(error);
          })
          .finally(() => conn.close());
      });
    }

    clearExpiredSessions(cb?: (err?: any) => void): void {
      const sql = `DELETE FROM ${this.options.schema.tableName} WHERE ${this.options.schema.columnNames.expires} < :expir`;
      const params = {
        expir: Math.round(Date.now() / 1000),
      };
      this.getOraConn().then(conn => {
        conn
          .execute<string>(sql, params, { autoCommit: true })
          .then(() => {
            cb && cb();
          })
          .catch(error => {
            cb && cb(error);
          })
          .finally(() => conn.close());
      });
    }

    setExpirationInterval(interval?: number) {
		  interval || (interval = this.options.checkExpirationInterval);
		  setInterval(() => this.clearExpiredSessions, interval);
	  };
  }

  return OracleSessionStore;
};

export default store;
