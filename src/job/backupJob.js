import cron from "node-cron";
import { executarBackupAutomatico } from
  "../services/backupService.js";

export function iniciarBackupJob() {
  cron.schedule("0 2 * * *", async () => {
    console.log("[Backup] Iniciando backup diário...");

    try {
      await executarBackupAutomatico();
    } catch (error) {
      console.error("[Backup] Erro:", error);
    }
  }, {
    timezone: "America/Sao_Paulo",
    noOverlap: true
  });

  console.log("[Backup] Agendador iniciado: 02:00");
}