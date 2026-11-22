# Philips Pocket Zapper — Android IR and Wi-Fi bridge

Aplicativo Android nativo que abre a interface atual do Philips Pocket Zapper e fornece a ponte para recursos Android.

## Modelo-alvo atual
- Televisor: **Philips 50PUG6654/78**, plataforma SAPHI.
- Rede: consulta a API local SAPHI nas versões suportadas pelo app.
- Power em standby: Wake-on-LAN usando o endereço MAC informado, condicionado ao suporte e à configuração de rede em standby da TV.
- Infravermelho: o Android detecta emissor e frequências disponíveis, mas o perfil de códigos deste modelo ainda não foi validado.

## Segurança dos comandos IR
O mapa IR fica intencionalmente vazio até que sinais específicos do controle original sejam capturados ou obtidos de uma fonte técnica confiável. Não usar códigos genéricos Philips nem presumir RC5/RC6. O app não deve indicar transmissão IR bem-sucedida sem código confirmado.

## Limitações reais
- A interface PWA em navegador não acessa diretamente ConsumerIrManager; o APK fornece a ponte nativa.
- A API SAPHI normalmente só responde quando a TV está ligada e acessível na rede.
- Para acordar a TV desligada, Wake-on-LAN só funciona se a TV aceitar o pacote em standby e o MAC estiver correto.
- Envio do pacote ou resposta HTTP não prova que a TV executou o comando.
- A validação final requer testar na TV física e em aparelho Android compatível.

## Compilar
Abrir a pasta android no Android Studio ou executar o workflow Android APK no GitHub Actions.