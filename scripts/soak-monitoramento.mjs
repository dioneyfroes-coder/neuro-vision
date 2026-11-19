/**
 * Soak test do monitoramento com telemetria real (Fase 7).
 *
 * Executar com: node --import tsx scripts/soak-monitoramento.mjs [opções]
 *
 * O servidor de teste é isolado em um diretório temporário. Nenhum dado de
 * vídeo é gravado em logs/; somente o relatório JSON vai para logs/soak/.
 */
import { main } from "./soak-monitoramento/main.mjs";

await main();
