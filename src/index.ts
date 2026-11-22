import "dotenv/config";
import { app } from "./app";

app.listen(Number(process.env.PORT ?? 3000));
console.log(`ready on http://localhost:${app.server?.port}`);
