// Word lists shared by the decoders, the normaliser and the OCR and typo clean-up.

/** Attack-relevant words (4+ letters). Near misses of these are snapped back in OCR and typo clean-up. */
export const ATTACK_WORDS: string[] = `ignore ignoring disregard forget override bypass previous prior above earlier instructions instruction
rules rule guidelines system prompt prompts reveal print output repeat verbatim password passwords credentials secret
secrets token tokens assistant assistants agent agents model models admin administrator developer mode identity persona
policies policy restrictions unrestricted freed instead outdated invalid summarising summarizing summary review reviews
five star stars send forward email transfer payment payments account bank details changed approve approved refund
refunds delete remove execute command shell read include contents reply notes parameter remember future conversations
conversation always never without verification confirmation authorized authorised documents anyone whenever tell scams
vendor vendors invoices invoice notice supersedes customer customers otp card number schedule interview candidate
score recommend product upload share history memory store permanently preferences combine follow decode reverse
backwards letter words phrase phrases game fictional world begin character stay agreed safety task response answer
start sure warnings refuse previous everything before told given directive directives objective real actual new
updated hidden note attention summarize summarise models summarizing screener applicant exceptional immediate
modify repository dependency mirror registry install script curl bash environment variables values ticket support
login portal stored using reply include contents ssh aws process paste field cookie session header authorization
oracle unrestricted restrictions answers everything hacker longer grandmother passwords asleep opposite reverse
apex traders pre-approved auto-approved identity verification repeat customers permanently share documents asks
approve vendor bank-detail automatically skip call-back release beneficiary outstanding amount delay quarterly
numbers link silently workspace asking two-factor authentication security team consent page accept immediately approval content account immediately authorized authorised documents everything earlier history database export customer beneficiary directives guidance disregard payment invoice skip`
  .split(/\s+/)
  .filter((w, i, a) => w.length >= 4 && a.indexOf(w) === i);

// Frequent English words (function words plus the business and AI vocabulary attacks use). The
// share of these in a string says whether it reads as English: ROT13 or reversed English scores
// near zero, and decoding it brings the share back up.
export const EN_WORDS = new Set(
  `the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did does said should must may might need please send share reply read write tell ask call find show print list keep remember forget ignore follow answer help run open paste copy forward transfer pay approve review check confirm delete remove change update add move start stop let put set enable disable allow everything anything something nothing every each both another more less many much few old same different full hidden secret real actual right next last before earlier later above below again always never often still already soon today here where when why how whom whose those account bank card number money amount refund refunds payment invoice vendor vendors customer user users assistant agent agents model system prompt instructions instruction rules policy policies restrictions password key keys token file files document documents email emails message messages conversation conversations history records data database export backup report ticket support team finance manager admin developer mode content word words phrase phrases text page site web link code command script note notes request approval audit compliance access details information order orders beneficiary immediately away future approved passed told given word reading summarising summarizing future anyone asks hide recommend only paid already ai api env otp pin cvv ssh llm https http www curl bash wget sudo tools tool script install download fix server saved stored through anything update bhai ek kaam karo karna kar do jaldi kisi ko batana mat hai hain ka ki ke se aur nahi abhi please yeh woh`.split(/\s+/)
);

const ATTACK_SET = new Set(ATTACK_WORDS);
export const isKnownWord = (w: string) => EN_WORDS.has(w) || ATTACK_SET.has(w);

/** Short words attackers spell out letter by letter ("Y O U", "A I"); longer runs are joined regardless. */
export const SHORT_SPELLED = new Set("you all are to ai run env the and now new not any api key pin otp cvv ssh for say act dan its ask pay use get set put off bot llm gpt cmd".split(" "));

/** Real words whose letters are a shuffle of an attack word's (checked against a 235k-word dictionary). */
export const SCRAMBLE_EXCEPTIONS = new Set("athenor besauce cloud conservation costumer felid felis frist froward patrol pervious reserve screet sorted three toady".split(" "));
