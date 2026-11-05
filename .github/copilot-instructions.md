# Santa Brisa - memoria do projeto

Memoria fixa e versionada do projeto. Leia antes de alterar codigo e mantenha-a atualizada conforme a regra no final.

## Produto e prioridades

- Jogo de direcao e exploracao urbana: Three.js + cannon-es + TypeScript/Vite, UI em DOM/CSS sem framework. Mapa demo em grade (Santa Brisa, offline) e cidades reais geradas pelo servico local `server/` (OSM, Copernicus DEM, Microsoft footprints, Sentinel-2) via `/api/geo`.
- **Prioridade maxima: fluidez constante.** 60 fps estaveis, sem picos ao dirigir e sem degradacao com o tempo de uso. Nenhuma mudanca pode piorar isso sem medicao e justificativa.
- Fidelidade geografica e aproximada. Nunca substituir dados ausentes silenciosamente: falhas viram avisos visiveis.

## Arquitetura a preservar

- Contrato de mapa discriminado (`kind: 'grid' | 'real'`). Controle, audio e UI nao dependem de coordenadas de grade. Contrato geo em `src/geo/types.ts`; mudancas no pipeline incrementam a versao usada nas chaves de cache.
- Coordenadas: X leste, Z sul, Y elevacao, 1 unidade = 1 m.
- Loop em `src/main.ts`: fisica em passo fixo `FIXED_STEP = 1/60`, ate 6 subpassos e acumulador limitado a um passo (sem espiral de recuperacao). A renderizacao interpola entre `previousPosition/previousQuaternion` e a pose atual usando `alpha`.
- Ao teleportar corpos (reset, recover, sair do carro), copiar tambem `previousPosition`/`previousQuaternion` para nao interpolar o salto.
- Terreno visual, heightfield fisico e amostragem compartilham a mesma triangulacao. Superficies sao recortadas nos triangulos do piso; colisores de pontes derivam dos mesmos triangulos visiveis.
- Vias: `width:carriageway` prevalece sobre `width`; preservar faixas declaradas e explicitar estimativas. Pintura acompanha a geometria do piso em metros, sem objetos por faixa, e e interrompida nos cruzamentos. Nao alargar fontes para acomodar o carro nem deslocar polilinhas para inventar curvas. `ROAD_PIPELINE_VERSION` versiona novas geracoes sem invalidar caches compativeis antigos.
- Cidades reais: malhas agrupadas em setores de 128 m, visiveis ate 850 m. Todos os colisores estaticos (predios, pontes, limites) sao transmitidos por setor: ativos a menos de 260 m do jogador **ou** do carro estacionado. Colisores de predios sao pre-construidos em fatias de 1 ms a menos de 480 m e reaproveitados. A ativacao ocorre antes do passo fisico.
- O hook de desenvolvimento `window.__game` (`snapshot`, `advance`, `pixels`) sustenta os testes de navegador; mantenha-o compativel.

## Fisica (cannon-es): armadilhas conhecidas

- `DrivingWorld` troca a `ArrayCollisionMatrix` padrao (O(n^2), zerada duas vezes por passo) por `ObjectCollisionMatrix`. Nao voltar ao padrao. Manter centenas de corpos ativos, nao milhares.
- `world.removeBody` e O(n) (reindexa todos os corpos); evitar adicionar/remover em massa a cada quadro.
- Ao mover/girar um corpo estatico, definir `aabbNeedsUpdate = true`, senao parte dos raios das rodas falha.
- `RaycastVehicle`: right=0, up=1, forward=2, axle=(-1,0,0); `engineForce` negativo acelera para +Z local.
- Tracao: `CarPhysics.driveType` (`fwd` padrao, `rwd`, `awd`) distribui `engineForce` entre rodas 0-1 (dianteiras) e 2-3 (traseiras); freio de mao sempre age nas traseiras. Escolha salva em `santa-brisa-settings.drive`. Validar com o teste de tipos de tracao em `tests/simulation.test.ts`.
- NPCs cinematicos usam `allowSleep: false`: atribuir velocidade nao acorda um corpo dormindo.
- `TerrainRay` inclui bordas compartilhadas da malha; `GroundHeightfield` limita cada celula pelas quatro alturas. Sem isso as rodas perdem contato em celulas descendentes ou em sela.
- Personagem a pe: `WALK_SPEED = 6`, sem amortecimento linear, `ContactMaterial` sem atrito contra `world.defaultMaterial`. Chao e caixas estaticas precisam declarar `world.defaultMaterial`.
- Camera: forward=(sin(yaw),0,cos(yaw)); esquerda da tela=(cos(yaw),0,-sin(yaw)). `Input.steer` e positivo para A e nao deve ser negado ao andar.
- Visibilidade e resposta de colisao de NPCs andam juntas.

## Desempenho

- Nada de `new Vector3/Vec3/Color/Quaternion` em caminhos por quadro, por passo ou por roda: usar temporarios reutilizaveis.
- Trabalho pesado (geometria, colisores, ConvexPolyhedron) fica no carregamento ou e fatiado por orcamento de tempo.
- Medir antes e depois: profiler CDP via Playwright, `__game.physics.bodies.length`, tempo de `physics.step` e tempos de quadro (mediana/p99/max). Referencia atual no Recife 5 km: passo de 1 a 2 ms com 350 a 800 corpos, quadro de 16,7 ms.
- InstancedMesh para frota e elementos repetidos, materiais compartilhados, pixel ratio limitado e sombras desligadas na qualidade Leve.

## Testes e validacao

- `npm test` (Vitest), `npx tsc --noEmit`, `npm run build`.
- Com o Vite rodando: `npm run test:browser`, `npm run test:geo-browser`, `npm run test:recife`. Use `TEST_URL` quando a porta nao for 5173. O teste do Recife exige `REAL_CITY_ID=766096f989f225643fa10fb933811ecc`.
- Playwright: Chromium completo (`channel: 'chromium'`) com GPU normal; SwiftShader causou timeouts.
- Regressoes verificam comportamento fisico real (contato das rodas, colisao, direcao sustentada, entrada/saida), nao apenas pixels ou aceleracao.
- Nao validado: gamepad fisico e celulares reais.

## Convencoes

- TypeScript compacto, sem abstracoes para uso unico. Comentarios curtos, apenas para o que o codigo nao mostra.
- Textos de UI e README em portugues; seguir o padrao de acentuacao do arquivo editado.
- README registra decisoes e limitacoes; atualize-o quando um comportamento documentado mudar.
- Git: desenvolver em `develop`; `main` recebe por fast-forward. Identidade apenas local (`git config --local`), nunca global. Commits curtos no estilo Conventional (`feat:`, `fix:`, `perf:`, `chore:`).

## Licoes aprendidas

- **Pistas e faixas:** a normalizacao descartava tags de faixas e trechos independentes deixavam bordas desalinhadas. Preservar metadados, compartilhar secoes nas juncoes terrestres e pintar no material existente; alinhar NPCs as faixas. Validar todos os segmentos de Recife, fisica em vias de referencia, screenshots dia/noite desktop/movel e profiler com/sem pintura. Dimensoes estimadas nao comprovam fidelidade real.
- **Iluminacao noturna:** carro e ruas ficavam escuros demais. Ajustes de luz exigem screenshots desktop/movel de dia e de noite, preservando o ceu escuro.
- **Personagem lento e lateral invertida:** atrito padrao de uma esfera com rotacao fixa consumia a velocidade, e o sinal do steer estava negado. Cobrir quatro direcoes, diagonais, soltura, parede e WASD real.
- **Consistencia das cidades reais:** testes de aceleracao e pixels nao provavam continuidade do piso. O DSM criava rampas de 35,8%; a filtragem urbana reduziu para 9,6%. Colisores de pontes e saida do carro precisam usar as formas reais, nao AABBs.
- **Degradacao de desempenho (2026-11-05):** cerca de 2.600 corpos estaticos sempre ativos e a matriz de colisao O(n^2) levavam o passo a 17 ms. A solucao foi `ObjectCollisionMatrix`, streaming de todos os colisores por setor, pre-construcao fatiada, acumulador limitado e interpolacao de renderizacao. Resultado: passo de 0,9 ms. Sempre investigar com profiler antes de supor vazamentos.

## Regra de manutencao desta memoria

A cada alteracao de codigo relevante (correcao de bug, nova mecanica, mudanca de arquitetura, fisica, desempenho, pipeline geografico, testes ou fluxo de trabalho), antes de concluir a tarefa:

1. Registre em **Licoes aprendidas** um item curto: problema, causa raiz, solucao e como validar.
2. Atualize as secoes de arquitetura, armadilhas, desempenho, testes ou convencoes quando a mudanca alterar um ponto-chave. Corrija ou remova o que ficou obsoleto em vez de acumular contradicoes.
3. Mantenha o arquivo enxuto (ate cerca de 150 linhas): consolide licoes semelhantes e prefira regras gerais a historicos detalhados.
4. Nao registre mudancas triviais (renomes, textos, formatacao) nem dados sensiveis.
5. Inclua a atualizacao desta memoria no mesmo commit da alteracao de codigo.
