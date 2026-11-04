# Santa Brisa

Jogo de direcao e exploracao urbana em uma cidade costeira ficticia. Sem missoes, pontuacao ou inventario: entre no carro, escolha uma estacao e explore.

## Executar

Requer Node.js 22.18+ ou 24+, npm e um navegador moderno com WebGL 2 e aceleracao grafica. Chrome e Edge sao os alvos principais.

```sh
npm install
npm run dev
```

Abra o endereco mostrado pelo Vite, normalmente http://127.0.0.1:5173. O servidor procura outra porta se ela estiver ocupada.

```sh
npm run build
npm run preview
```

A pasta `dist` pode ser publicada em hospedagem estatica. Nao ha backend, chaves de API, streaming ou dependencias de servicos externos em tempo de execucao. Fontes, geometria e audio sao locais.

## Jogar

Clique em **Explorar a cidade**. O personagem comeca ao lado do carro verde na Orla do Sol. Pressione **E** para entrar.

| Controle | Acao |
| --- | --- |
| W / seta para cima | Acelerar; andar para a frente a pe |
| S / seta para baixo | Frear; engatar re depois de parar |
| A, D / setas laterais | Direcao; andar lateralmente a pe |
| Espaco | Freio de mao |
| E | Entrar ou sair, apenas com o carro parado |
| C | Alternar camera de acompanhamento e proxima |
| Arrastar no mundo | Olhar ao redor |
| R / N | Proxima estacao / proxima musica |
| M | Silenciar todo o audio |
| Esc / H | Pausa e ajustes / controles |

Em telas de toque, use as setas e o botao de entrada/saida. Camera e radio tambem possuem botoes. O mapa pequeno mostra as ruas proximas, o mar e a orientacao do jogador, sem rotas ou objetivos.

Gamepads com mapeamento padrao: analogico esquerdo para direcao, RT/LT para acelerar/frear e re, A para entrar/sair, B para freio de mao, X para camera, Y para estacao, Start para pausa. A implementacao esta presente, mas nao foi validada com hardware fisico nesta entrega.

O menu permite alterar volume, qualidade grafica e velocidade do tempo. **Reposicionar carro** recupera um veiculo preso ou capotado na via proxima. Volume, qualidade e estado do radio sao salvos localmente; o estado do mundo nao e salvo. Ao perder visibilidade, a pagina pausa a simulacao e o audio.

## Experiencia Implementada

- Cidade de aproximadamente 630 x 630 metros, 25 quarteiroes e uma malha conectada de ruas com cruzamentos, faixas, calcadas e semaforos.
- Centro com edificios mais altos, Vila Aurora, Jardins, Distrito das Artes, parques e Orla do Sol. Torre central, comercio e letreiro da cidade como referencias.
- Carro com chassis dinamico, quatro rodas com suspensao raycast, tracao traseira, direcao progressiva dependente da velocidade, freios, re e freio de mao. Limite de aproximadamente 130 km/h e 32 km/h em re.
- Colisoes com edificios, limites do mapa, fonte central, trafego e pedestres. A camera consulta a fisica para evitar atravessar obstaculos.
- Personagem controlavel a pe, verificacao de proximidade para entrar, escolha de um lado livre para sair e transicao visual curta.
- Ate 30 carros em rotas fechadas, incluindo circuitos que atravessam mais de um quarteirao. Reducao de velocidade nos sinais, distancia de seguranca, reacao ao jogador e parada apos contato.
- 64 pedestres em rotas de calcada, sentidos alternados e animacao de caminhada. Parte das rotas cruza ruas nas faixas; pedestres aguardam uma oportunidade e aceleram a travessia diante de um carro proximo.
- Tempo continuo: um dia em 12 minutos por padrao, com duas velocidades alternativas. A luz solar, o ceu, a neblina, as sombras, as janelas, os postes e os farois acompanham o horario.
- Tres estacoes, cada uma com tres composicoes instrumentais originais, sequenciadas em Web Audio. Troca de estacao/faixa, reproducao continua, volume e desligamento. Som sintetizado de motor acompanha aceleracao e velocidade.

## Decisoes Tecnicas

**Three.js** oferece controle direto do custo da cena e dos materiais. O mundo ocupa a tela inteira; a interface usa DOM e CSS, sem uma camada React que nao seria necessaria para este escopo.

**cannon-es** resolve contatos, gravidade, suspensao e tracao. A simulacao utiliza passos fixos de 1/60 s, broadphase SAP e limite de subpassos. Nao ha movimentacao do carro por teletransporte durante a direcao.

**TypeScript e Vite** fornecem contratos entre sistemas, verificacao estatica e empacotamento. Fontes sao distribuidas via Fontsource e os icones sao do Lucide.

**Web Audio** produz musica e motor localmente, com agendamento antecipado de notas e liberacao dos nos encerrados. O contexto de audio so inicia apos uma interacao. As melodias, progressoes e nomes de faixa estao em `src/systems/audio.ts`; nao sao gravacoes comerciais nem streams externos.

## Estrutura

| Modulo | Responsabilidade |
| --- | --- |
| `src/main.ts` | Inicializacao, loop fixo, integracao e ciclo da pagina |
| `src/core/physics.ts` | Mundo fisico e configuracao do veiculo |
| `src/core/input.ts` | Teclado, gamepad e entrada por toque |
| `src/world/map.ts` | Definicao da cidade, quarteiroes, distritos e sinais |
| `src/world/city.ts` | Geracao visual e colisores do mapa |
| `src/world/models.ts` | Geometria original de carros e personagens |
| `src/systems/player.ts` | Personagem, veiculo, interacao e recuperacao |
| `src/systems/population.ts` | Rotas, trafego, pedestres e renderizacao da frota |
| `src/systems/daylight.ts` | Relogio, ceu e iluminacao solar |
| `src/systems/audio.ts` | Radio, composicoes e som do motor |
| `src/systems/camera.ts` | Cameras e consulta de obstaculos |
| `src/ui.ts`, `src/style.css` | HUD, menus, ajustes e layout responsivo |

Novas cidades podem fornecer outra definicao de mapa e outro gerador tematico, preservando os sistemas de controle, audio e interface. O gerador atual e intencionalmente especifico de Santa Brisa. Novos veiculos requerem geometria e parametrizacao fisica; estacoes sao dados e regras de sintese separadas.

## Desempenho

- Instancing para edificios, janelas, arvores, sinalizacao, iluminacao e a frota de veiculos.
- Geometria low-poly, materiais compartilhados, descarte visual de NPCs distantes e animacao de pedestres apenas quando proximos.
- Populacao limitada, menor quantidade de carros noturnos fora da vista e densidade maior nos circuitos compartilhados da Vila Aurora.
- Apenas oito luzes de poste proximas e uma luz direcional com sombras. Farol do jogador usa dois spots sem mapas de sombra adicionais.
- Pixel ratio limitado a 1, 1.5 ou 2 conforme a qualidade; a opcao Leve desativa sombras.
- A cidade compacta permanece residente em memoria. Nao ha streaming de setores nem LOD de malhas detalhadas: o modelo base ja e simplificado. Essas tecnicas seriam necessarias para mapas significativamente maiores.

No Chromium automatizado deste ambiente, uma amostra final registrou cerca de 30 FPS, 64 chamadas de desenho e 236 mil triangulos. Isso nao e uma garantia para outros computadores. Os testes moveis usam emulacao de viewport e toque, nao um telefone fisico.

## Validacao

```sh
npm test
npm run build
npx playwright install chromium
```

Com o servidor de desenvolvimento executando em outra janela:

```sh
npm run test:browser
```

O teste usa `http://127.0.0.1:5173`; a variavel `TEST_URL` permite outra porta. No PowerShell: `$env:TEST_URL = 'http://127.0.0.1:5174'`.

Os testes de simulacao verificam suspensao, aceleracao, frenagem, re, velocidade maxima, colisao com parede, sinais sem conflito, continuidade de rotas, tres minutos simulados de trafego, sincronizacao entre rota e corpo, reacao a obstaculos, ciclo completo de dia/noite e entrada/saida.

O teste Playwright verifica pixels nao vazios, aceleracao e frenagem por teclado, saida segura, radio com sinal real de audio, cameras, pausa, ajustes, diferenca visual entre dia/noite, limite do mapa, estabilidade por mais de tres minutos simulados e direcao por toque. Capturas ficam em `test-results/`, incluindo desktop, celular vertical e horizontal. O acesso `window.__game` existe apenas no servidor de desenvolvimento, para diagnostico e testes; nao e incluido na versao de producao.

## Limites Atuais

- Fisica de direcao orientada a uma experiencia arcade consistente, nao a simulacao automotiva profissional. Nao ha danos mecanicos, deformacao ou transmissao manual.
- NPCs usam controladores cinematicos com rotas predefinidas, nao planejamento livre de destinos, ultrapassagem ou desvio complexo de um bloqueio permanente. Um jogador que bloqueia uma faixa pode manter a fila parada ate liberar a via.
- Pedestres param ou aceleram a caminhada; nao ha ragdoll, combate ou animacao de impacto. Entrada/saida usa transicao, nao uma animacao corporal completa de porta.
- Calcadas e pequenos objetos decorativos nao possuem todos colisores individuais. Edificios, limites, fonte e NPCs possuem colisao.
- Farol do trafego e emissivo; apenas o carro do jogador projeta feixes dinamicos. O ceu nao inclui clima, estrelas ou reflexos avancados.
- A trilha e instrumental sintetizada e repetitiva por concepcao, com variacao entre faixas; nao pretende reproduzir a producao de uma radio comercial.
- A interface possui nomes acessiveis, foco visivel, menus com foco contido e controles alternativos. O mundo 3D depende de visao e controle espacial; nao e uma experiencia integralmente acessivel por leitor de tela.

Todos os modelos e composicoes deste projeto foram criados para esta experiencia. A referencia a jogos urbanos da era PS2 e apenas conceitual; nao sao utilizados mapas, personagens, marcas, musicas ou recursos desses jogos.