# Sancathon Discord Infrastructure

Ferramenta de Infrastructure as Code e auditoria do servidor **Sancathon 2026**. Ela compara a configuração versionada com o estado atual do Discord, mostra um plano e só altera o servidor quando `--apply` é informado explicitamente.

O primeiro release é deliberadamente não destrutivo: recursos extras aparecem como `UNMANAGED`; nenhum cargo, categoria, canal, membro ou overwrite desconhecido é excluído.

## Requisitos e instalação

- Node.js 24.17.0 ou superior;
- bot já adicionado à guild;
- guild com o modo Comunidade habilitado para criar fóruns ou palco;
- token do bot e ID da guild.

Instale exatamente as versões registradas no lockfile:

```powershell
npm ci
```

Crie o arquivo local de credenciais:

```powershell
Copy-Item .env.example .env
notepad .env
```

Preencha sem aspas:

```env
DISCORD_TOKEN=token_do_bot
GUILD_ID=123456789012345678
```

`.env`, `.state/`, `reports/` e `node_modules/` estão no `.gitignore`. O token não é incluído no snapshot, plano, estado ou relatório e o retorno de `Client#login`, que contém o token, é descartado. O `.env` continua sendo texto local: restrinja o acesso ao seu usuário e revogue o token imediatamente se ele for exposto.

## Comandos

```powershell
# comportamento padrão: conecta, lê e planeja; não altera o Discord
node setup.js
node setup.js --dry-run

# executa o plano após validação e preflight
node setup.js --apply

# revisa/aplica o restante e adia temporariamente o cargo Administração
node setup.js --dry-run --defer-role administration
node setup.js --apply --defer-role administration

# auditoria somente leitura
node audit.js

# testes puros, sem conexão com o Discord
npm test
npm run check
```

## Segurança do repositório

O CI executa testes e verificação de sintaxe em todo push e pull request para `main`. O Dependabot verifica semanalmente dependências npm e GitHub Actions. As Actions são fixadas por SHA, o workflow possui somente permissão de leitura e nenhuma credencial do Discord é usada no CI.

Vulnerabilidades devem seguir [SECURITY.md](SECURITY.md). Nunca publique tokens, `.env`, relatórios privados ou arquivos de state em issues e pull requests.

O apply executa cargos, hierarquia, categorias, canais, parent/posição, overwrites e configurações específicas em fases. Depois ele lê a guild novamente e refaz o planejamento. O state só é salvo atomicamente em `.state/discord-resources.json` quando o plano convergiu.

Quando um cargo existente ainda estiver acima do bot, `--defer-role <key>` cria uma exceção explícita e temporária. A edição desse cargo, sua participação na reordenação e os overwrites direcionados a ele ficam como `DEFERRED`; todas as demais operações continuam sujeitas ao preflight. O argumento não aceita cargos ausentes, `everyone` nem cargos com erro de planejamento. Repita o argumento para mais de uma key. Remova-o assim que a hierarquia for liberada e rode primeiro o dry-run normal.

## Permissões e hierarquia do bot

O código não testa por `Administrator`; testa as capacidades realmente exigidas pelo plano:

- `Manage Roles` para criar/editar/ordenar cargos e editar overwrites;
- `Manage Channels` para criar/editar/ordenar categorias e canais;
- as próprias permissões que o bot tentará conceder a um cargo ou overwrite;
- `View Channel` é recomendado para auditar canais privados;
- `View Audit Log` é opcional nesta versão, pois o audit log não é consultado.

O maior cargo do bot precisa ficar **acima de todos os cargos gerenciados**, inclusive `Administração`. `Administrator` não ignora essa regra de hierarquia.

Há uma limitação de bootstrap imposta pelo Discord: um bot sem `Administrator` não consegue criar/conceder `Administrator` ao cargo `Administração`. Para a primeira execução, crie esse cargo manualmente com essa permissão ou conceda a capacidade temporariamente e remova-a depois. Para os demais cargos, dê ao bot somente a união das permissões que ele precisa conceder.

Alterar permissões ou a posição do cargo do bot no servidor **não exige reinstalar o bot**. Só é necessário autorizar novamente se ele não estiver na guild ou se os scopes OAuth2 precisarem mudar.

## Estado desejado

- [config/server.js](config/server.js): guild esperada, equipes, feature flags e políticas de segurança;
- [config/roles.js](config/roles.js): cargos, cores, permissões e hierarquia relativa;
- [config/channels.js](config/channels.js): categorias, canais, slowmode, fóruns, tags e overwrites.

Feature flags atuais:

```js
stageEnabled: false,
eventCategoryVisibleToParticipants: false,
```

Ao liberar a categoria do evento, altere apenas `eventCategoryVisibleToParticipants` para `true` e confira o dry-run antes do apply.

## Matching e idempotência

Na primeira execução, o planner resolve recursos por nome canônico e aliases explícitos, sem fuzzy matching. Depois, os IDs salvos no state têm prioridade. Matches ambíguos, IDs com tipo incompatível, cargos gerenciados por integração e bits de permissão desconhecidos geram erro e bloqueiam o apply.

Aliases cobrem a migração atual, inclusive `Organização` → `Administração`, `Organização2` → `Organização`, `Equipe 1` → `Equipe 01` e `duvida-dos-treinamentos` → `duvidas-dos-treinamentos`. O canal extra `bem-vindo` não é tratado como alias de `boas-vindas` e permanece `UNMANAGED`.

Overwrites de membros/cargos desconhecidos e tags de fórum desconhecidas são preservados. Canais de tipos incompatíveis nunca são recriados automaticamente.

## Auditoria

`node audit.js` gera:

```text
reports/
  discord-report.json
  discord-report.md
```

O JSON possui schema estável, snowflakes/bitfields como strings, permissões decodificadas, hierarquia, cores, canais, parent, slowmode, sincronização, overwrites, voz e tags de fórum. O Markdown organiza os mesmos dados para revisão humana. Threads não fazem parte do snapshot desta versão.

## Arquitetura

```text
config/                 estado desejado puro
src/config/             ambiente e validação
src/discord/            cliente e snapshot normalizado
src/planner/            matching, diff e plano sem efeitos colaterais
src/apply/              preflight e execução em fases
src/audit/              relatório JSON e Markdown
src/state/              IDs estáveis e escrita atômica
src/utils/              nomes, permissões e coleções
setup.js                CLI dry-run/apply
audit.js                CLI somente leitura
test/                   testes Node sem rede
```

## Limitações conhecidas

- não exclui recursos nem remove membros;
- não gerencia bans, kicks automáticos, DMs, onboarding ou datas;
- não converte tipos incompatíveis de canal;
- não gerencia threads existentes;
- recursos do sistema e integrações continuam `UNMANAGED`;
- fóruns e palco dependem dos recursos disponíveis na guild.

## Relatório PowerShell legado

O fluxo anterior foi preservado para compatibilidade:

```powershell
.\configurar-credenciais.ps1
.\relatorio-discord.ps1
.\tests\relatorio-discord.Tests.ps1
```

Ele usa credenciais protegidas por DPAPI fora do repositório e gera os CSVs/JSON legados. Essas credenciais não são copiadas automaticamente para `.env`; o fluxo Node e o fluxo PowerShell permanecem separados para evitar expor o token durante uma migração automática.
