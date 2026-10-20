# Apresentação protegida por senha

Página: https://joaoaleximoveisap-web.github.io/lovablex-celular/apresentacao/

Quem abre a página digita a senha e vê a apresentação interativa. Ela usa o mesmo motor do
Palco (repositório `leadsprospeccao`): câmera com zoom entre os slides, animações
de entrada, números que contam, 7 efeitos (Cinema, Imersivo, Suave, Clean,
Tradicional, Dissolver, Ágil), visão geral, pinça para aproximar e tela cheia.
Dá para instalar na tela de início (no Safari: Compartilhar → Adicionar à Tela de Início;
no Chrome: botão Instalar). Depois da primeira vez, abre sem internet.

## Trocar a apresentação ou a senha

```sh
node apresentacao/montar/montar.mjs arquivo.pptx --senha "nova senha" --titulo "Nome que aparece na tela de senha"
git add apresentacao/dados.palco apresentacao/versao.json && git commit -m "Apresentação: nova versão" && git push
```

- Nunca coloque o `.pptx` no repositório: ele é público. Só o `dados.palco` (trancado) vai para o GitHub.
- O `dados.palco` é criptografado com AES-256-GCM, com a chave tirada da senha (PBKDF2-SHA256, 310 mil rodadas). Sem a senha, não dá para ler nada.
- Limite do GitHub: 100 MB por arquivo (o script avisa acima de 95 MB).
- Quem marcou "Lembrar neste aparelho" abre direto. Se a senha mudar, o app pede a nova.

## Importador

`importador.js` é gerado a partir de `palco/*.ts` (cópia de `src/lib/pptx.ts`, `zip.ts` e
`model.ts` do Palco, mais `entrada.ts`). Para refazer depois de atualizar o Palco:

```sh
npx esbuild apresentacao/montar/palco/entrada.ts --bundle --format=iife --target=chrome120 --minify --legal-comments=none --outfile=apresentacao/montar/importador.js
```
