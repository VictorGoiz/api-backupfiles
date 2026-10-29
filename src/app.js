import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { executarBackupAutomatico } from "./services/backupService.js";

const app = express();
const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";

app.use(cors());
app.use(helmet({ 
    contentSecurityPolicy: false,       // Permite compatibilidade com scripts/estilos locais e APIs externas
    crossOriginResourcePolicy: false
}));
app.use(morgan(morganFormat));
app.use(express.json());

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: "SensiMonitor API Backup Service"
    });
});

app.post("/backup/executar", async (req, res) => {
    try {
        const { inicio, fim } = req.body || {};
        const resultado = await executarBackupAutomatico({ inicio, fim });
        res.status(200).json(resultado);
    } catch (error) {
        console.error("[Backup API] Erro ao executar backup:", error);
        res.status(500).json({
            sucesso: false,
            erro: error.message || "Erro interno ao executar o backup"
        });
    }
});

export default app;
