import snowflake, { Connection, SnowflakeError } from 'snowflake-sdk';
import dotenv from 'dotenv';

dotenv.config();

// // Configure snowflake-sdk to return large integers as BigInt - Removed global config
// snowflake.configure({jsTreatIntegerAsBigInt: true}); 

// Function to process the private key from .env format
const formatPrivateKey = (key: string | undefined): string => {
    if (!key) return '';
    // Replace literal \n from .env with actual newlines
    return key.replace(/\\n/g, '\n'); 
};

// Updated connection options for Key-Pair Authentication
const connectionOptions = {
  account: process.env.SNOWFLAKE_ACCOUNT || '',
  username: process.env.SNOWFLAKE_USER || '', // Use SNOWFLAKE_USER from .env
  authenticator: 'SNOWFLAKE_JWT', // Use JWT authenticator
  privateKey: formatPrivateKey(process.env.SNOWFLAKE_PRIVATE_KEY), // Use formatted private key
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || '',
  database: process.env.SNOWFLAKE_DATABASE || '',
  schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC',
  role: process.env.SNOWFLAKE_ROLE, // Role is still relevant
  // clientStoreTemporaryCredential is not needed for key-pair
};

// --- Validation for key variables ---
if (!connectionOptions.account) {
    console.error('Error: SNOWFLAKE_ACCOUNT environment variable is not set.');
    process.exit(1);
}
if (!connectionOptions.username) {
    console.error('Error: SNOWFLAKE_USER environment variable is not set.');
    process.exit(1);
}
if (!connectionOptions.privateKey) {
    console.error('Error: SNOWFLAKE_PRIVATE_KEY environment variable is not set or invalid.');
    process.exit(1);
}
// ---

/**
 * Creates a connection, connects using key-pair authentication,
 * executes a query, and destroys the connection.
 *
 * @param sqlText The SQL query string.
 * @param binds Optional array of bind variables for the query.
 * @returns A promise that resolves with the query results.
 * @throws Throws an error if the query fails or connection fails.
 */
export async function executeQuery<T>(sqlText: string, binds?: any[]): Promise<T[]> {
  // 1. Create Connection
  const connection = snowflake.createConnection(connectionOptions);
  let connected = false; // Flag to track connection state

  try {
    // 2. Connect using connect (synchronous for key-pair, wrap in promise for async flow)
    await new Promise<void>((resolve, reject) => {
        connection.connect((err: SnowflakeError | undefined, conn: Connection) => {
            if (err) {
                console.error('Unable to connect using key-pair: ' + err.message);
                // Log sensitive details carefully or omit in production
                // console.error('Connection options used (excluding private key):', { ...connectionOptions, privateKey: '***' });
                reject(err);
            } else {
                console.log('Successfully connected to Snowflake via key-pair. Connection ID: ' + conn.getId());
                connected = true; // Mark as connected
                resolve();
            }
        });
    });

    // 3. Set session parameter for case-insensitive identifiers
    await new Promise<void>((resolve, reject) => {
      connection.execute({
        sqlText: 'ALTER SESSION SET QUOTED_IDENTIFIERS_IGNORE_CASE = TRUE;',
        complete: (err, _stmt) => {
          if (err) {
            console.error('Failed to set session parameter QUOTED_IDENTIFIERS_IGNORE_CASE:', err.message);
            reject(err); // Fail the operation if session parameter cannot be set
          } else {
            // console.log('Session parameter QUOTED_IDENTIFIERS_IGNORE_CASE set to TRUE.'); // Reduce noise
            resolve();
          }
        }
      });
    });

    console.log(`Executing query: ${sqlText.substring(0, 100)}...`); // Log truncated query
    if (binds) {
      // Add replacer to handle BigInt during stringification for logging
      const replacer = (_key: string, value: any) => // Use _key to indicate unused parameter
        typeof value === 'bigint' ? value.toString() : value;
      console.log(`With binds: ${JSON.stringify(binds, replacer)}`);
    }

    // 4. Execute the statement on the connected client
    const rows = await new Promise<T[]>((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) {
            console.error(`Failed to execute statement: ${err.message}`);
            reject(err);
          } else {
            console.log(`Query successful. Rows fetched: ${rows?.length ?? 0}`);
            resolve(rows as T[] || []); // Ensure rows is always an array
          }
        },
      });
    });
    return rows;

  } catch (err) {
    console.error('Error during query execution or connection:', err);
    throw err; // Re-throw the error
  } finally {
    // 5. Destroy the connection if it was successfully established
    if (connected) { // Only destroy if connectAsync succeeded
       await new Promise<void>((resolve, _reject) => { // Use _reject as reject might be unused
            connection.destroy((err: SnowflakeError | undefined, conn: Connection) => {
                if (err) {
                    console.error('Failed to destroy connection: ' + err.message);
                    // Don't reject in finally, just log
                } else {
                    console.log('Connection destroyed successfully. ID was: ' + conn.getId());
                }
                resolve(); // Always resolve in finally
            });
       });
    } else {
        console.log('Skipping destroy for connection that failed to establish.');
    }
  }
}

/**
 * Optional: Function to test the connection using key-pair and manual creation/destruction.
 */
export async function testConnection(): Promise<boolean> {
   // 1. Create Connection
  const connection = snowflake.createConnection(connectionOptions);
  let connected = false;

   try {
    // 2. Connect using connect (synchronous for key-pair, wrap in promise for async flow)
    await new Promise<void>((resolve, reject) => {
        connection.connect((err: SnowflakeError | undefined, conn: Connection) => {
            if (err) {
                console.error('Test Connection - Unable to connect using key-pair: ' + err.message);
                reject(err);
            } else {
                 console.log('Test Connection - Successfully connected via key-pair. Conn ID: ' + conn.getId());
                 connected = true;
                 resolve();
            }
        });
    });

    // 3. Optional: Execute a simple query to be sure
    await new Promise<void>((resolve, reject) => {
        connection.execute({
            sqlText: 'SELECT 1;',
            complete: (err, _stmt, _rows) => {
                if (err) {
                    console.error('Test Connection - SELECT 1 failed:', err.message);
                    reject(err);
                } else {
                    console.log('Test Connection - SELECT 1 successful.');
                    resolve();
                } 
            }
        });
    });

    console.log('Snowflake key-pair connection test successful.');
    return true;

  } catch (error) {
    console.error('Snowflake key-pair connection test failed:', error);
    return false;
  } finally {
     // 4. Destroy the connection
     if (connected) {
       await new Promise<void>((resolve, _reject) => { // Use _reject
            connection.destroy((err: SnowflakeError | undefined, conn: Connection) => {
                if (err) {
                    console.error('Test Connection - Failed to destroy connection: ' + err.message);
                    // Log error but don't fail the test function in finally block
                } else {
                    console.log('Test Connection - Connection destroyed. ID was: ' + conn.getId());
                }
                 resolve();
            });
       });
     } else {
         console.log('Test Connection - Skipping destroy for connection that failed to establish.');
     }
  }
} 