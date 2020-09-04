import oracledb from "oracledb";
import { Store } from "express-session";

const defaultOptions = {
  checkExpirationInterval: 900000, // How frequently expired sessions will be cleared; milliseconds.
  expiration: 86400000, // The maximum age of a valid session; milliseconds.
  createDatabaseTable: true, // Whether or not to create the sessions database table, if one does not already exist.
  schema: {
    tableName: "sessions",
    columnNames: {
      session_id: "session_id",
      expires: "expires",
      data: "attributes",
    },
  },
};

interface SessionInstance {
  Store: Store;
}

abstract class StoreClassFactory {
  
}

const store = (session: SessionInstance): Store => {
  class OracleSessionStore extends Store {
    constructor(options = defaultOptions) {
      super(options);
    }
    
  }
  return OracleSessionStore;
};
