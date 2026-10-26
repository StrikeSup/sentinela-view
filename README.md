# Sentinela VIEW

Aplicativo Windows com servidor local, interface Guardian, player nativo LibVLC e entrega WebRTC ao navegador. Snapshot de desenvolvimento; não representa paridade completa com DGuard nem produto pronto para produção.

## Estrutura
- `application/`: fontes C#/.NET 8 Windows, API local, conectores, vídeo nativo e diagnóstico.
- `frontend/`: frontend baseado em StrikeSup/guardian-connect e adaptadores locais.

## Compilar e executar
Requer Windows x64, .NET SDK 8, Node.js/npm e WebView2 Runtime. Execute `Build.ps1` e depois `out/Center.exe` para criar a conta local. Com o cadastro inicial criado, execute `out/Center.exe --guardian-native`. Acesse http://127.0.0.1:8095/auth.

A integração Intelbras Cloud ainda referencia assemblies da instalação autorizada em `C:/Seventh/IntegrationService/`. Eles NÃO estão incluídos nem licenciados por este repositório. Sem essa dependência, a compilação dessa integração não está disponível. Não há implementação independente completa do SDK de serviço.

Para WebRTC, obtenha MediaMTX da distribuição oficial e coloque `mediamtx.exe` em `../local-media/mediamtx/` em relação à raiz deste repositório (caminho atualmente esperado a partir de `out`). A conversão H.265 utiliza `ffmpeg.exe` no diretório de sistema do Windows. Esses caminhos ainda precisam de configuração portátil. LibVLC é restaurado por NuGet.

## Diagnóstico
`/diagnostico-webrtc` requer login. Registra etapas do pedido, primeiro quadro informado pelo navegador e amostras do player nativo. Primeiro quadro não mede atraso absoluto da cena. A chegada do primeiro pacote do DVR ainda não é medida separadamente.

## Limitações
Nem todas as telas Guardian estão integradas. Licença local não ativa licenças comerciais; gravação, detecção, failover e integrações de produção não têm equivalência completa. O atraso do aplicativo em relação ao navegador continua em investigação.

Não inclui cadastros, credenciais, vídeos, certificados, logs, histórico de engenharia reversa, DLLs proprietárias ou recursos visuais extraídos do DGuard. Dados locais são criados em tempo de execução e devem permanecer privados. Recursos de terceiros mantêm seus direitos e condições originais; nenhuma licença geral foi atribuída nesta publicação.
