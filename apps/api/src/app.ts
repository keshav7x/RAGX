import 'dotenv/config'
import cookieParser from "cookie-parser"
import express from "express"
import helmet from "helmet"
import cors from "cors"

import { envConfig } from "@/config/envConfig"
import { errorMiddleware, notFoundMiddleware } from "@/Middlewares/error.middleware"
import authRoutes from "@/Modules/Auth/Routes/auth.routes"
import documentRoutes from "@/Modules/Documents/Routes/document.routes"
import projectRoutes from "@/Modules/Projects/Routes/project.routes"

const app = express()

app.use(helmet())
app.use(cors({
  origin: envConfig.WEB_APP_URL,
  credentials: true,
}))

app.use(express.json({ limit: "15mb" }))
app.use(cookieParser())

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "OK" })
})
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/projects", projectRoutes)
app.use("/api/v1", documentRoutes)

// Alias /v1 routes to match the official SDK and README documentation
app.use("/v1", documentRoutes)


app.use(notFoundMiddleware)
app.use(errorMiddleware)

export default app
