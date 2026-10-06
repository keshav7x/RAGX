import 'dotenv/config'
import cookieParser from "cookie-parser"
import express from "express"
import helmet from "helmet"
import cors from "cors"

import { envConfig } from "@/config/envConfig"
import { errorMiddleware, notFoundMiddleware } from "@/Middlewares/error.middleware"
import authRoutes from "@/Modules/Auth/Routes/auth.routes"
import documentRoutes from "@/Modules/Documents/Routes/document.routes"
import knowledgeBaseRoutes from "@/Modules/KnowledgeBases/Routes/knowledge-base.routes"
import projectRoutes from "@/Modules/Projects/Routes/project.routes"

const app = express()

app.use(helmet())
app.use(cors({
  origin: envConfig.WEB_APP_URL,
  credentials: true,
}))

// 21mb fits a 15MB document (base64 inflates raw bytes ~4/3) plus JSON
// overhead, so the service-level 15MB check stays authoritative. Anything
// larger fails closed as a clean 413 via `isPayloadTooLargeError`.
app.use(express.json({ limit: "21mb" }))
app.use(cookieParser())

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "OK" })
})
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/projects", projectRoutes)
app.use("/api/v1", documentRoutes)
app.use("/api/v1/knowledge-bases", knowledgeBaseRoutes)

// Alias /v1 routes to match the official SDK and README documentation
app.use("/v1", documentRoutes)


app.use(notFoundMiddleware)
app.use(errorMiddleware)

export default app
