// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

// prettier-ignore
export const ASCII_ART =
`


                                                     ##*++++*###
                                                  #+-:.......:--=+#
                                               *+-:::----------:--==*#
                                              *-:-----------::--::=++=*
                                            #=:-::-==--------------+++=#
                                           *=..:--==-=-----==------+++==#
                                          #-..:--==-=:----====----=+*++=#
                                         *::.:-===-=-----====-:--=+++++=#
                                        +-:.:-===-=---=-====-:-==++++++=#
                                       *:-:--=====--=-======:-==++++++=#*
                                     #+:::--====-------====:-==++++++=+*
                                    *=:::--====-:----=====--==+++++++=*
                                   #=:::-======:-========-:===++++++=*#
                                  #-::--======:-==---===-:===++++++=+#
                                 *----:-=====--:.......--===*+++++==#*
                                *--:...:==-:...........:===+++++**+**
                               *......:................:==-=++***++#
                             #=......:..:........:......---++**++++*
                            #=......::..................:-==+**+++**
                           #=.....:::::................:-==-+*+++*+*
                          *-......::::.......:........:-==--++++#==#
                         *-........:..........:...:...:-=-:-++=*#*+#
                        *:.........................:::-==----=+*
                       *:.......:....................::=-------+
                      *-............................::-----=#*-+
                      *-::......-=:.:++-...:-......::==----*##=+
                       ***=.=*--**+++#*+.:**++:::=+=::----=***-+
                       *=++-**++++**+*+=.-**+==-+*+*-.----+*++.=*
                      #=-++-***==**#*===++=*##**+==*=.--=**+++:=#
                      #*+#+-#  ##  #=-----+###++*-=*=.-+***++#*+
                         +-:#     #-:----=### ###-=#+.-***+**
                         +..=#   #=:-----*##    #-=#=.:=#
                         =..-#   +:-----+*%     #:-#-::=+
                         *+=*+  *:-----=*##     #:-#*==+*
                              #*:-----=**#      #::#
                              *-------+*#       *::#
                             #=------+*##       +.:*
                             #*-----+*##       #-..+
                               %#***#%         +:..-#
                                               =:..-+
                                               +:..=*
                                               #*=+*#


                                                                                                    `;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const LOGO_ORANGE = '\x1b[38;5;208m';
const LOGO_GOLD = '\x1b[38;5;214m';
const LOGO_CREAM = '\x1b[38;5;230m';
const LOGO_AMBER = '\x1b[38;5;220m';
const LOGO_BROWN = '\x1b[38;5;130m';

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function color(text: string, ansi: string, enabled: boolean): string {
  return enabled ? `${ansi}${text}${RESET}` : text;
}

function logoLineColor(lineIndex: number, lineCount: number): string {
  const position = lineIndex / Math.max(lineCount - 1, 1);
  if (position < 0.32) return LOGO_ORANGE;
  if (position < 0.48) return LOGO_GOLD;
  if (position < 0.68) return LOGO_CREAM;
  if (position < 0.86) return LOGO_AMBER;
  return LOGO_BROWN;
}

function colorizeAsciiArt(art: string, enabled: boolean): string {
  const lines = art.split('\n').map(line => line.trimEnd());
  const nonEmptyIndexes = lines
    .map((line, index) => line.trim() ? index : -1)
    .filter(index => index >= 0);
  const nonEmptyCount = nonEmptyIndexes.length;
  let visibleIndex = 0;

  return lines.map(line => {
    if (!line.trim()) return line;
    const ansi = logoLineColor(visibleIndex, nonEmptyCount);
    visibleIndex += 1;
    return color(line, ansi, enabled);
  }).join('\n');
}

export function printBanner(version: string): void {
  const useColor = shouldUseColor();
  console.log(colorizeAsciiArt(ASCII_ART, useColor));
  const name = color('CRMy', BOLD, useColor);
  const versionLabel = color(`v${version}`, LOGO_ORANGE, useColor);
  const separator = color('-', DIM, useColor);
  console.log(`  ${name}  ${versionLabel}  ${separator}  Operational customer context for AI agents\n`);
}
