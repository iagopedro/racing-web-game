# Santa Brisa

Jogo de direcao e exploracao urbana com cidades reais geradas a partir de dados abertos e Santa Brisa como demonstracao ficticia offline. Sem missoes, pontuacao ou inventario: entre no carro, escolha uma estacao e explore.

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

A pasta `dist` pode ser publicada em hospedagem estatica para a demonstracao offline. Cidades reais usam o servico Node local descrito abaixo; `vite` e `vite preview` encaminham `/api/geo` para ele. O servico escuta apenas em `127.0.0.1:8787`, nao e um backend publico de producao. Fontes tipograficas, modelos dos personagens e audio continuam locais.

## Cidades reais

Em outro terminal, execute:

```sh
npm run geo:serve
```

Reinicie o Vite caso ele ja estivesse aberto antes da criacao de `vite.config.ts`. Abra **Cidades reais** no topo da tela:

1. Informe o nome e o centro por latitude/longitude WGS84. O formulario inicia em **Recife Antigo**, latitude `-8.0631`, longitude `-34.8712`.
2. Escolha um recorte quadrado de **0.2 a 5 km de lado**. Comece com 1 km; 5 km pode conter milhares de edificios.
3. O relevo Copernicus habilitado usa **filtragem urbana aproximada**, para nao transformar telhados em rampas. Desabilita-lo escolhe terreno plano, registrado nos avisos.
4. Opcionalmente habilite footprints Microsoft, referencias de imagens e/ou textura Sentinel-2.
5. Clique em **Gerar e abrir cidade**. A primeira geracao depende da rede e pode levar minutos. A partida reinicia ao trocar de cidade.

Os recortes normalizados e as respostas OSM reutilizaveis ficam em `.geo-cache/`, fora do Git. O cache de geracao dura 24 horas; **Atualizar fontes** ignora esse prazo. Uma URL `?city=<id>` reabre o recorte salvo mesmo apos esse prazo, sem consultar os provedores. O servico local precisa estar ativo para servi-lo; a URL nao transfere o cache para outro computador. **Abrir Santa Brisa offline** volta ao mapa local sem requisicoes geograficas.

O contrato atual e a **versao 2**. Recortes da primeira implementacao sao rejeitados com mensagem para gerar novamente: seus dados nao incluem as correcoes de terreno, larguras e areas de circulacao. As chaves de cache incluem a versao do pipeline.

### Busca de cidades por nome

**O Nominatim publico exige decisao explicita do responsavel pela aplicacao e cumprimento da [politica de uso](https://operations.osmfoundation.org/policies/nominatim/).** A busca vem desativada. Para uma instalacao local de uso moderado, apos aceitar essa politica, configure no terminal do servidor:

```powershell
$env:NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
npm run geo:serve
```

Use **Buscar cidade** e selecione o resultado; ajuste as coordenadas se quiser um bairro especifico. Nao ha autocomplete. As buscas sao serializadas, espacadas por pelo menos 1.1 s, identificadas por User-Agent e cacheadas por 30 dias. Os termos pesquisados sao enviados ao provedor; nao envie dados pessoais. O limite do servico publico e agregado por aplicacao, nao por instalacao: nao distribua muitas instancias apontando para ele. Para mais usuarios, configure uma instancia propria ou outro provedor compativel. `NOMINATIM_URL` e `OVERPASS_URL` permitem trocar os endpoints sem modificar o codigo.

### Fontes integradas

| Fonte | Integracao | Limites e atribuicao |
| --- | --- | --- |
| [OpenStreetMap / Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) | Ruas curvas, cruzamentos, rotatorias, edificios, multipoligonos com patios, pracas pavimentadas, parques, rios e costa | ODbL 1.0; atribuicao permanente. Uma consulta por geracao; erros 502/503/504 do endpoint padrao permitem uma tentativa no espelho Kumi, mas 429 nao gera retry. |
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | Catalogo por quadkey, leitura streaming de GeoJSONL gzip, recorte espacial e complemento de edificios ausentes | CDLA Permissive 2.0; OSM tem prioridade. Sobreposicao >15% da menor area descarta o footprint ML. Alturas positivas sao estimativas ML; `-1` e ausencia. Downloads limitados a 128 MB comprimidos / 768 MB descompactados por tile. |
| [Copernicus DEM GLO-30 / AWS](https://registry.opendata.aws/copernicus-dem/) | Leitura parcial HTTP Range de COGs, mosaico de tiles, amostragem ~30 m e filtragem urbana | DSM, nao DTM. O piso e uma aproximacao filtrada; `terrain.rawHeights` preserva as amostras brutas e `terrain.datum` a origem vertical EGM2008. NoData/falhas abortam o relevo solicitado, nunca o substituem silenciosamente por um plano. |
| [OpenAerialMap](https://docs.openaerialmap.org/api/api/) | Busca de imagens por bounding box, datas, licenca e links de referencia | Cobertura local, nao global. Nenhuma imagem e um resultado explicito. Consulte a licenca/atribuicao da imagem antes de redistribui-la. |
| [Copernicus Sentinel-2 / Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a) | Busca STAC por recorte, ate 3 cenas com cobertura de nuvens <20%, referencias e textura RGB opcional | Textura reprojetada em EPSG:4326, recortada ao mesmo bbox e cacheada como PNG 1024 x 1024. Resolucao nativa RGB ~10 m, sem classificacao automatica; nao equivale a fotografia de fachadas. |

O catalogo Microsoft padrao foi verificado em 2026-11-04 e aponta para a publicacao de 2026-08-13. `MS_BUILDINGS_INDEX_URL` permite atualizar o indice. Nenhuma dessas integracoes exige chave de API; disponibilidade e limites dos servicos publicos nao sao garantidos. As falhas de fontes complementares aparecem no painel de qualidade, sem interromper os dados principais. Nao ha download automatico de areas ilimitadas.

O painel **Cidades reais** mostra contagens, data da geracao, fontes, licencas, referencias visuais e estimativas. Para o relevo adaptado, aplica-se o aviso:

> produced using Copernicus WorldDEM-30 &copy; DLR e.V. 2010-2014 and &copy; Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

Consulte a [licenca Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM). Texturas incluem o aviso `Contains modified Copernicus Sentinel data <ano>`. Preserve as atribuicoes e avalie as obrigacoes ODbL/CDLA ao redistribuir bancos de dados combinados ou recortes; gratuidade nao elimina as licencas.

### Pipeline geografico e limites de fidelidade

- `src/geo/types.ts` define o contrato independente do renderizador. O servico valida nome, centro, opcoes e tamanho, consulta as fontes, normaliza e grava JSON atomicamente. Uma geracao por vez; cancelamento, timeout de 9 minutos e limites de resposta evitam trabalho ilimitado.
- Projecao local equiretangular com raios WGS84 na latitude central: **X leste, Z sul, Y elevacao; 1 unidade = 1 metro**. Adequada a recortes pequenos, nao a uso cadastral. Latitudes suportadas: -75 a 75 graus; recortes cruzando o antimeridiano sao rejeitados.
- Ruas sao polilinhas reais, nao uma grade inventada. Recorte de linhas nao fecha vias abertas. Poligonos preservam concavidades e aneis internos. Altura de edificio usa `height`, depois `building:levels * 3`, depois estimativa explicita de 9 m; `min_height` e respeitado. Valores extremos sao limitados a 1500 m.
- Larguras usam `width`/`width:carriageway`, depois numero de faixas valido, depois classe/sentido da via. `widthSource` diferencia largura declarada, derivada e estimada. Uma rua nao e alargada arbitrariamente para acomodar a fisica; trechos pedonais continuam distintos de vias para carros.
- `width:carriageway` tem prioridade sobre `width`. Novas geracoes preservam `lanes`, `lanes:forward` e `lane_markings=no`; a revisao viaria tem versao propria na chave de cache, sem invalidar recortes antigos. Neles, faixas ausentes sao estimadas com referencia de 3 m, nunca alterando a largura total para caber o carro de 1,88 m.
- Demarcacoes acompanham o mesmo piso/curvas: bordas brancas, divisorias tracejadas no mesmo sentido e separacao amarela de sentidos opostos; sao interrompidas nos cruzamentos mapeados. Trechos terrestres conectados compartilham bordas; pontes preservam seu contorno fisico. Pintura usa os materiais agrupados existentes, sem objetos por faixa nem atualizacao por quadro. O trafego segue o centro da faixa externa.
- A demarcacao e aproximada, nao um levantamento da sinalizacao do Recife: estacionamento, faixas exclusivas, permissoes de ultrapassagem e cruzamentos sem conexao mapeada ainda exigem dados especificos. Faixas declaradas abaixo de 2,5 m nao sao alargadas; a pintura e omitida e um aviso pede revisao. A geometria acompanha a polilinha OSM, sem suavizacao que desloque a rua para dentro de edificios.
- Terreno visual, heightfield fisico e amostragem compartilham triangulacao. A filtragem usa abertura morfologica de 5 x 5 amostras e tres convolucoes 3 x 3; preserva tendencias amplas, mas nao recupera um DTM medido. Superficies viarias sao recortadas nos triangulos do piso. Extrusoes e colisores preservam concavidades/patios.
- Os raios de suspensao/camera usam intersecao de terreno que inclui as bordas compartilhadas. Os limites de celula consideram as quatro alturas, nao somente os extremos diagonais: isso evita perder contato com o piso em celulas descendentes ou em sela.
- Malhas sao agrupadas em setores de 128 m. Colisores sao ativados **antes** do passo fisico e mantidos tanto perto do jogador quanto do carro estacionado. O minimapa usa os mesmos dados e o HUD mostra a rua mais proxima. O recorte inteiro fica em memoria; nao ha streaming mundial.
- Inicio/recuperacao verificam a area do carro e do personagem contra os footprints, nao apenas pontos isolados. A saida do carro testa as formas fisicas reais, sem bloquear patios apenas por estarem dentro de uma AABB. Na tela de boas-vindas real, o jogador nao desliza enquanto espera.
- NPCs usam ciclos conectados das vias, sentido unico e deslocamento para a faixa; trajetos que invadem edificios sao descartados. Obstaculos em niveis diferentes nao bloqueiam a fila. Pedestres usam vias pedonais e reconhecem cruzamentos com ruas. Visibilidade e resposta de colisao acompanham-se. Preferencias e semaforos reais ainda nao sao simulados.
- Pontes mantem o tracado, mas alturas continuam aproximadas. O colisor do tabuleiro deriva dos mesmos triangulos visiveis, inclusive em curvas. Tuneis permanecem excluidos da navegacao. Os limites do recorte possuem barreiras visiveis e indicacao no HUD, nao paredes invisiveis.
- A costa OSM e unida por seus extremos e fechada no limite geografico, preservando ilhas. Fragmentos incompletos geram avisos, sem fechamento inventado em terra. Agua e vegetacao ainda sao representacoes visuais, sem hidrodinamica, natacao ou classificacao ML de imagens.
- A textura de satelite nao cria fachadas. Cores sem tags, telhados simplificados e alturas ausentes sao ilustrativos. A aplicacao continua sendo um **prototipo geografico low-poly**, nao uma replica visual do Recife nem um levantamento de engenharia.

### Revisao de consistencia

A primeira entrega tinha testes de aceleracao e pixels, mas isso nao comprovava continuidade do piso ou fidelidade espacial. A revisao acrescentou regressao para:

| Falha encontrada | Verificacao adicionada |
| --- | --- |
| Suspensao perdia contato e o chassis encalhava em ruas visualmente livres | Raios curtos em terrenos descendentes/em sela e nas diagonais; direcao fisica sustentada em ruas reais |
| DSM criava rampas de ate 35.8% no centro do Recife | Comparacao de inclinacoes brutas/filtradas, preservacao das amostras e teste de terreno inclinado |
| Pracas pavimentadas eram descartadas e faltava o litoral | Poligonos de circulacao, costa fragmentada, ilhas, referencias de terra/agua e nomes reais |
| Tabuleiro curvo e colisor tinham contornos diferentes | Centenas de raios comparando exatamente malha e corpo nas bordas das pontes |
| Saida bloqueada por AABB e obstaculos descarregados perto do carro estacionado | Entrada/saida dentro de patio, limites visiveis e ativacao de setores |
| NPCs no eixo central, bloqueio entre niveis e colisores ocultos | Posicao na faixa, obstaculos elevados, rotas degeneradas e paridade entre visibilidade/colisao |
| Carro sobreposto a um edificio era empurrado para baixo do piso e ficava preso | Colisores de edificios descem 4 m abaixo do terreno; teste de parede sobreposta e sondagem de centenas de saidas de via no Recife |
| Vias, faixas e areas piscavam ao mover a camera (z-fighting entre camadas quase coplanares e tracejado sem filtragem) | Superficies sobre o terreno sao desenhadas como decalques em ordem fixa (agua/grama, piso, vias) sem gravar profundidade; pontes e telhados continuam solidos; pintura com filtragem de cobertura. Pixels alternando entre quadros com a camera deslocada 2 cm cairam de 316 para 12 |

No recorte de 5 km usado na revisao, a inclinacao maxima amostrada das vias terrestres caiu de 35.8% para 9.6%. Isso e uma medida de consistencia de jogabilidade, **nao prova de exatidao altimetrica**. A fidelidade visual de fachadas, monumentos, sinalizacao e mobiliario continua incompleta.

API local: `GET /api/geo/health`, `GET /api/geo/search?q=...`, `POST /api/geo/maps[?refresh=1]`, `GET /api/geo/maps/<id>`. A geracao recebe `{ name, center: { lat, lon }, sizeKm, elevation, microsoft, imagery, texture? }` e retorna `{ id, warnings }`. Nao exponha esse servico na internet sem autenticar, limitar uso global, gerenciar armazenamento e adaptar a implantacao.

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

O menu permite alterar volume, qualidade grafica, tipo de tracao do carro (dianteira, traseira ou integral; o painel de velocidade exibe a tracao ativa) e velocidade do tempo. **Reposicionar carro** recupera um veiculo preso ou capotado na via proxima. Volume, qualidade, tracao e estado do radio sao salvos localmente; o estado do mundo nao e salvo. Ao perder visibilidade, a pagina pausa a simulacao e o audio.

## Experiencia Implementada

- Cidade de aproximadamente 630 x 630 metros, 25 quarteiroes e uma malha conectada de ruas com cruzamentos, faixas, calcadas e semaforos.
- Centro com edificios mais altos, Vila Aurora, Jardins, Distrito das Artes, parques e Orla do Sol. Torre central, comercio e letreiro da cidade como referencias.
- Carro com chassis dinamico, quatro rodas com suspensao raycast, tracao dianteira por padrao (traseira ou integral selecionavel nos ajustes), direcao progressiva dependente da velocidade, freios, re e freio de mao. Limite de aproximadamente 130 km/h e 32 km/h em re.
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
| `src/world/real-city.ts` | Terreno, superficies georreferenciadas, extrusoes e colisores de cidades reais |
| `src/geo/` | Contratos, coordenadas, normalizacao, rotas, cliente e seletor de cidades |
| `server/` | Provedores abertos, cache e API Node local |
| `src/systems/player.ts` | Personagem, veiculo, interacao e recuperacao |
| `src/systems/population.ts` | Rotas, trafego, pedestres e renderizacao da frota |
| `src/systems/daylight.ts` | Relogio, ceu e iluminacao solar |
| `src/systems/audio.ts` | Radio, composicoes e som do motor |
| `src/systems/camera.ts` | Cameras e consulta de obstaculos |
| `src/ui.ts`, `src/style.css` | HUD, menus, ajustes e layout responsivo |

O contrato de mapa discrimina a demonstracao em grade e as cidades geograficas. Ambos preservam os sistemas de controle, audio e interface; nenhum sistema precisa tratar uma rua real como uma coordenada de grade. Novos veiculos requerem geometria e parametrizacao fisica; estacoes sao dados e regras de sintese separadas.

## Desempenho

- Instancing para edificios, janelas, arvores, sinalizacao, iluminacao e a frota de veiculos.
- Geometria low-poly, materiais compartilhados, descarte visual de NPCs distantes e animacao de pedestres apenas quando proximos.
- Populacao limitada, menor quantidade de carros noturnos fora da vista e densidade maior nos circuitos compartilhados da Vila Aurora.
- Apenas oito luzes de poste proximas e uma luz direcional com sombras. Farol do jogador usa dois spots sem mapas de sombra adicionais.
- Pixel ratio limitado a 1, 1.5 ou 2 conforme a qualidade; a opcao Leve desativa sombras.
- A cidade compacta permanece residente em memoria. Nao ha streaming de setores nem LOD de malhas detalhadas: o modelo base ja e simplificado. Essas tecnicas seriam necessarias para mapas significativamente maiores.

Os numeros acima descrevem Santa Brisa. Em cidades reais, densidade de edificios e complexidade dos poligonos variam; o limite de 5 km nao e garantia de desempenho em celulares.

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
npm run test:geo-browser
```

O teste usa `http://127.0.0.1:5173`; a variavel `TEST_URL` permite outra porta. No PowerShell: `$env:TEST_URL = 'http://127.0.0.1:5174'`.

Os testes de simulacao verificam suspensao, aceleracao, frenagem, re, velocidade maxima, colisao com parede, sinais sem conflito, continuidade de rotas, tres minutos simulados de trafego, sincronizacao entre rota e corpo, reacao a obstaculos, ciclo completo de dia/noite e entrada/saida.

Os testes geograficos usam fixtures deterministicas sem rede: coordenadas em metros, limites, recorte, multipoligonos/patios, alturas, deduplicacao OSM/ML, rotas sem atalhos inventados, correspondencia entre terreno visual/fisico, conduzir/entrar/sair em terreno elevado, cache e erros de fontes. `test:geo-browser` verifica selecao de cidade, navegacao, atribuicao, avisos e layout desktop/mobile. Para adicionar um smoke test de um recorte Copernicus ja gerado, defina `REAL_CITY_ID` com seu id e execute o mesmo comando. Capturas ficam em `test-results/`.

Para a regressao mais rigorosa com dados reais, gere 5 km centrados em `-8.0631, -34.8712`, com relevo habilitado, e execute:

```powershell
$env:TEST_URL = 'http://127.0.0.1:5174'
$env:REAL_CITY_ID = '<id do recorte versao 2>'
npm run test:recife
```

Esse teste verifica referencias de terra/agua, preservacao do Patio de Sao Pedro, inclinacoes, ausencia de deriva antes de iniciar, 150 m de direcao fisica em cada uma de tres vias (Alfredo Lisboa, Riachuelo e Dantas Barreto), entrada/saida e mais de 55 m de caminhada na Rua do Bom Jesus. Para isolar a continuidade do piso, a colisao com NPCs e desabilitada somente nessa etapa de direcao; a interacao com a populacao e verificada nas suites de simulacao. A visao aerea de diagnostico desativa a neblina apenas para a captura do teste.

O teste Playwright verifica pixels nao vazios, aceleracao e frenagem por teclado, saida segura, radio com sinal real de audio, cameras, pausa, ajustes, diferenca visual entre dia/noite, limite do mapa, estabilidade por mais de tres minutos simulados e direcao por toque. Capturas ficam em `test-results/`, incluindo desktop, celular vertical e horizontal. O acesso `window.__game` existe apenas no servidor de desenvolvimento, para diagnostico e testes; nao e incluido na versao de producao.

## Limites Atuais

- Fisica de direcao orientada a uma experiencia arcade consistente, nao a simulacao automotiva profissional. Nao ha danos mecanicos, deformacao ou transmissao manual.
- NPCs usam controladores cinematicos com rotas predefinidas, nao planejamento livre de destinos, ultrapassagem ou desvio complexo de um bloqueio permanente. Um jogador que bloqueia uma faixa pode manter a fila parada ate liberar a via.
- Pedestres param ou aceleram a caminhada; nao ha ragdoll, combate ou animacao de impacto. Entrada/saida usa transicao, nao uma animacao corporal completa de porta.
- Calcadas e pequenos objetos decorativos nao possuem todos colisores individuais. Edificios, limites, fonte e NPCs possuem colisao.
- Farol do trafego e emissivo; apenas o carro do jogador projeta feixes dinamicos. O ceu nao inclui clima, estrelas ou reflexos avancados.
- A trilha e instrumental sintetizada e repetitiva por concepcao, com variacao entre faixas; nao pretende reproduzir a producao de uma radio comercial.
- A interface possui nomes acessiveis, foco visivel, menus com foco contido e controles alternativos. O mundo 3D depende de visao e controle espacial; nao e uma experiencia integralmente acessivel por leitor de tela.

Os modelos dos personagens/veiculos, a demonstracao ficticia e as composicoes foram criados para esta experiencia. As cidades reais derivam das fontes geograficas e licencas listadas acima. A referencia a jogos urbanos da era PS2 e apenas conceitual; nao sao utilizados mapas, personagens, marcas, musicas ou recursos desses jogos.