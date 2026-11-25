/**
 * The analysis of email templates, report types and quick actions (decision record 0077), on small files that are
 * written here, for what the fixture project does not have. The fixture project has one of each, which its answer
 * key measures (`fixture-key.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { key, Source, told, xml } from './helpers/written-source.ts';

/**
 * An invoice with its lines and their payments, a lookup to an account and one to a contact, a field of the
 * account, a custom setting, and a user with a hierarchy field.
 */
const project = (): Source => {
  const source = new Source();
  source.object('Invoice__c', '<label>Invoice</label>');
  source.field('Invoice__c', 'Amount__c', '<type>Currency</type>');
  source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
  source.field(
    'Invoice__c',
    'Account__c',
    '<type>Lookup</type>',
    '<referenceTo>Account</referenceTo>',
    '<relationshipName>Invoices</relationshipName>',
  );
  source.object('Invoice_Line__c', '<label>Invoice Line</label>');
  source.field(
    'Invoice_Line__c',
    'Invoice__c',
    '<type>MasterDetail</type>',
    '<referenceTo>Invoice__c</referenceTo>',
    '<relationshipName>Lines</relationshipName>',
  );
  source.field('Invoice_Line__c', 'Quantity__c', '<type>Number</type>');
  source.object('Payment__c', '<label>Payment</label>');
  source.field(
    'Payment__c',
    'Line__c',
    '<type>Lookup</type>',
    '<referenceTo>Invoice_Line__c</referenceTo>',
    '<relationshipName>Payments</relationshipName>',
  );
  source.field('Payment__c', 'Amount__c', '<type>Currency</type>');
  source.field('Account', 'Tier__c', '<type>Picklist</type>');
  source.object('Settings__c', '<label>Settings</label>', '<customSettingsType>Hierarchy</customSettingsType>');
  source.field('Settings__c', 'Limit__c', '<type>Number</type>');
  source.field('User', 'Backup__c', '<type>Hierarchy</type>', '<relationshipName>Backups</relationshipName>');
  return source;
};

const analysed = async (source: Source): Promise<SourceAnalysis> =>
  analyseSource(source.tree, (await resolveComponents(source.tree, [''])).components);

/** The issues of an analysis, as `severity CODE component message`. */
const issuesOf = (analysis: SourceAnalysis): string[] =>
  analysis.issues.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)} ${issue.message}`);

describe('an email template', () => {
  const TEMPLATE = key('EmailTemplate', 'Billing/Overdue');
  const META = 'email/Billing/Overdue.email-meta.xml';
  const BODY = 'email/Billing/Overdue.email';

  /** The project with a template of these lines of metadata and this body. */
  const withTemplate = (meta: readonly string[], body: string | Uint8Array): Source => {
    const source = project();
    source.file('email/Billing.emailFolder-meta.xml', xml('EmailFolder', '<name>Billing</name>'));
    source.file(META, xml('EmailTemplate', '<available>true</available>', ...meta));
    source.file(BODY, body);
    return source;
  };

  it('of the classic kind names an object and its field, the users, the org and a custom setting', async () => {
    const analysis = await analysed(
      withTemplate(
        ['<name>Overdue</name>', '<subject>Invoice {!Invoice__c.Name} is overdue</subject>', '<type>text</type>'],
        [
          'Dear {!Contact.FirstName},',
          'invoice {!Invoice__c.Amount__c} is due. See {!Invoice__c.Link}.',
          'From {!Sending_User.Email} to {!Receiving_User.Department} and {!User.Title}, of {!Organization.Name}.',
          'Limit: {!$Setup.Settings__c.Limit__c}. {!Invoice__c}',
        ].join('\n'),
      ),
    );
    expect(told(analysis, TEMPLATE)).toEqual([
      // The subject, in the file of the metadata.
      '5:35 reads CustomField:invoice__c.name [Name] external merge-field',
      // The body. The link to the record is no field, and the object alone names nothing.
      '1:16 reads CustomField:contact.firstname [FirstName] external merge-field',
      '2:22 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
      '3:21 reads CustomField:user.email [Email] external merge-field',
      '3:48 reads CustomField:user.department [Department] external merge-field',
      '3:71 reads CustomField:user.title [Title] external merge-field',
      '3:97 reads CustomField:organization.name [Name] external merge-field',
      '4:29 reads CustomField:settings__c.limit__c [Limit__c] resolved merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([]);
    // The component holds its two files, and is analysed by the reader of XML.
    expect(analysis.components.find((one) => one.key === TEMPLATE)).toMatchObject({ definition: { path: META } });
    expect(analysis.work.find((one) => one.origin === 'parser:xml')?.failedFiles).toBe(0);
  });

  it('of the classic kind reads a formula in a merge field, a lookup field by its relationship and the owner', async () => {
    const analysis = await analysed(
      withTemplate(
        [
          '<attachedDocuments>Shared/Terms.pdf</attachedDocuments>',
          '<letterhead>Billing_Letterhead</letterhead>',
          '<name>Overdue</name>',
          '<textOnly>{!IF(ISBLANK(Invoice__c.Status__c), &quot;none&quot;, Invoice__c.Amount__c)}</textOnly>',
          '<type>custom</type>',
        ],
        [
          'Owner {!Invoice__c.OwnerEmail}, made by {!Invoice__c.CreatedBy} for {!Contact.Account}.',
          '{!ApprovalRequest.Comments} {!TODAY()} {!Invoice__c.Owner.Email} {!Invoice__c.Amount__c +}',
        ].join('\n'),
      ),
    );
    expect(told(analysis, TEMPLATE)).toEqual([
      // The letterhead and the document, which the project does not hold.
      '5:17 references null [Billing_Letterhead] unresolved template',
      '4:24 references null [Shared/Terms.pdf] unresolved attachment',
      // The formula of the text version, whose names start as the merge fields do.
      '7:39 reads CustomField:invoice__c.status__c [Status__c] resolved merge-field',
      '7:80 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
      // The owner's address and the user who made the record are the lookup fields, and so is the account.
      '1:20 reads CustomField:invoice__c.ownerid [OwnerEmail] external merge-field',
      '1:54 reads CustomField:invoice__c.createdbyid [CreatedBy] external merge-field',
      '1:79 reads CustomField:contact.accountid [Account] external merge-field',
      // The request of an approval is no record, and a formula of no name names nothing.
      '2:53 reads CustomField:invoice__c.ownerid [Owner] external merge-field',
      '2:59 reads CustomField:user.email [Email] external merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ ${TEMPLATE} ${BODY}, line 2: a merge field holds "Invoice__c.Amount__c +", which is not read as a name.`,
    ]);
  });

  it('says which merge field it did not read, and which it did not find closed, in the body as in the subject', async () => {
    const analysis = await analysed(
      withTemplate(
        ['<name>Overdue</name>', '<subject>{!IF(true, 1} and {!Invoice__c.Amount__c</subject>', '<type>html</type>'],
        '<p>{!Invoice__c.Status__c}</p>\n<p>{!1abc} {!Invoice__c.Amount__c</p>',
      ),
    );
    expect(told(analysis, TEMPLATE)).toEqual([
      '1:17 reads CustomField:invoice__c.status__c [Status__c] resolved merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ ${TEMPLATE} ${META}, line 5: a merge field in "subject" holds "IF(true, 1", which is not read as a name.`,
      `warning MERGE_FIELD_NOT_CLOSED ${TEMPLATE} ${META}, line 5: a merge field in "subject" is not closed. Nothing is read of it.`,
      `warning NAME_NOT_READ ${TEMPLATE} ${BODY}, line 2: a merge field holds "1abc", which is not read as a name.`,
      `warning MERGE_FIELD_NOT_CLOSED ${TEMPLATE} ${BODY}, line 2: a merge field is not closed. Nothing is read of it.`,
    ]);
    // A merge field of the body stands in no element, and its details say none.
    expect(analysis.issues.find((one) => one.details?.['path'] === BODY)?.details).toEqual({
      path: BODY,
      line: 2,
      column: 6,
    });
  });

  it('of the Lightning kind names the sender, the org and the related record, and does not follow the recipient', async () => {
    const analysis = await analysed(
      withTemplate(
        [
          '<name>Overdue</name>',
          '<relatedEntityType>Invoice__c</relatedEntityType>',
          '<subject>{{{Invoice__c.Name}}} {!Invoice__c.Status__c}</subject>',
          '<type>custom</type>',
          '<uiType>SFX</uiType>',
        ],
        'Hello {{{Recipient.FirstName}}}, {{{Invoice__c.Amount__c}}} from {{{Sender.Email}}} of {{{Organization.Name}}}.\n{{{Opportunity.Name}}} {{{Invoice__c.Link}}} {{{Invoice__c.Amount__c}',
      ),
    );
    expect(told(analysis, TEMPLATE)).toEqual([
      // The object of the related record.
      '5:24 references CustomObject:invoice__c [Invoice__c] resolved object',
      // A template made before Winter '19 writes its merge fields as a classic template does.
      '6:28 reads CustomField:invoice__c.name [Name] external merge-field',
      '6:49 reads CustomField:invoice__c.status__c [Status__c] resolved merge-field',
      '1:48 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
      '1:76 reads CustomField:user.email [Email] external merge-field',
      '1:104 reads CustomField:organization.name [Name] external merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ ${TEMPLATE} ${BODY}, line 2: a merge field holds "Opportunity.Name", and the template knows no "Opportunity". It is not read.`,
      `warning MERGE_FIELD_NOT_CLOSED ${TEMPLATE} ${BODY}, line 2: a merge field is not closed. Nothing is read of it.`,
      `warning PATH_NOT_FOLLOWED ${TEMPLATE} ${BODY}, line 1: it is not known which object "Recipient" holds, so "FirstName" after it was not followed.`,
    ]);

    // A template that Salesforce provides is of the same kind.
    const sample = await analysed(
      withTemplate(
        ['<name>Overdue</name>', '<type>custom</type>', '<uiType>SFX_Sample</uiType>'],
        '{{{Sender.Email}}}',
      ),
    );
    expect(told(sample, TEMPLATE)).toEqual(['1:11 reads CustomField:user.email [Email] external merge-field']);
  });

  it('of the Visualforce kind takes the objects of the records from the attributes of its markup', async () => {
    const markup = [
      '<messaging:emailTemplate subject="Total > 0" recipientType="Contact" relatedToType="Invoice__c">',
      '<messaging:plainTextEmailBody>{!recipient.FirstName}, {!relatedTo.Amount__c} {!relatedTo.Account__r.Tier__c}',
      '<apex:repeat value="{!relatedTo.Lines__r}" var="line">{!line.Quantity__c}</apex:repeat> {!TEXT(relatedTo.Amount__c)}',
      '</messaging:plainTextEmailBody>',
      '</messaging:emailTemplate>',
    ].join('\n');
    const analysis = await analysed(withTemplate(['<name>Overdue</name>', '<type>visualforce</type>'], markup));
    expect(told(analysis, TEMPLATE)).toEqual([
      // The objects of the two records. A value of another attribute can hold a ">".
      '1:85 references CustomObject:invoice__c [Invoice__c] resolved object',
      '1:61 references CustomObject:contact [Contact] external object',
      '2:43 reads CustomField:contact.firstname [FirstName] external merge-field',
      '2:67 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
      '2:90 reads CustomField:invoice__c.account__c [Account__r] resolved merge-field',
      '2:101 reads CustomField:account.tier__c [Tier__c] resolved merge-field',
      // A child relationship of the record is the lookup field that defines it, and a formula is read.
      '3:33 references CustomField:invoice_line__c.invoice__c [Lines__r] resolved merge-field',
      '3:106 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
    ]);
    // A variable that the markup declares is not known.
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ ${TEMPLATE} ${BODY}, line 3: a merge field holds "line.Quantity__c", and the template knows no "line". It is not read.`,
    ]);

    // Without the attributes, nothing says which object a record is of, and a name the template does not know is
    // not read.
    const without = await analysed(
      withTemplate(
        ['<name>Overdue</name>', '<type>visualforce</type>'],
        '<messaging:emailTemplate subject="Overdue">{!relatedTo.Amount__c} {!Invoice__c.Amount__c}</messaging:emailTemplate>',
      ),
    );
    expect(told(without, TEMPLATE)).toEqual([]);
    expect(issuesOf(without)).toEqual([
      `warning NAME_NOT_READ ${TEMPLATE} ${BODY}, line 1: a merge field holds "Invoice__c.Amount__c", and the template knows no "Invoice__c". It is not read.`,
      `warning PATH_NOT_FOLLOWED ${TEMPLATE} ${BODY}, line 1: it is not known which object "relatedTo" holds, so "Amount__c" after it was not followed.`,
    ]);
  });

  it('places a merge field of the body after a byte order mark and over lines that end in CRLF', async () => {
    const body = Buffer.concat([
      Uint8Array.of(0xef, 0xbb, 0xbf),
      Buffer.from('Dear é,\r\n\r\nthe sum is {!Invoice__c.Amount__c}.\r\n', 'utf8'),
    ]);
    const analysis = await analysed(withTemplate(['<name>Overdue</name>', '<type>text</type>'], body));
    expect(told(analysis, TEMPLATE)).toEqual([
      '3:25 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([]);
  });

  it('says that a body that is no text in UTF-8 is not read, and reads the file of its metadata', async () => {
    const analysis = await analysed(
      withTemplate(
        ['<name>Overdue</name>', '<subject>{!Invoice__c.Amount__c}</subject>', '<type>text</type>'],
        Uint8Array.of(0x7b, 0x21, 0xe9, 0x7d),
      ),
    );
    expect(told(analysis, TEMPLATE)).toEqual([
      '5:27 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `error XML_NOT_UTF8 null ${BODY}: The bytes of the file are not text in UTF-8.`,
    ]);
    expect(analysis.work.find((one) => one.origin === 'parser:xml')?.failedFiles).toBe(1);
  });

  it('reads a body in ISO-8859-1 where the file of its metadata says so and the bytes are no UTF-8', async () => {
    const body = Buffer.from('Montant dû : {!Invoice__c.Amount__c}', 'latin1');
    const meta = ['<name>Overdue</name>', '<type>text</type>'];
    const analysis = await analysed(withTemplate(['<encodingKey>ISO-8859-1</encodingKey>', ...meta], body));
    expect(told(analysis, TEMPLATE)).toEqual([
      '1:27 reads CustomField:invoice__c.amount__c [Amount__c] resolved merge-field',
    ]);
    expect(issuesOf(analysis)).toEqual([]);
    // Any other encoding is not read.
    const other = await analysed(withTemplate(['<encodingKey>Shift_JIS</encodingKey>', ...meta], body));
    expect(issuesOf(other)).toEqual([`error XML_NOT_UTF8 null ${BODY}: The bytes of the file are not text in UTF-8.`]);
  });

  it('reads nothing of the body where the file of its metadata is not that of an email template', async () => {
    const source = withTemplate([], '{!Invoice__c.Amount__c}');
    source.file(META, xml('EmailFolder', '<name>Overdue</name>'));
    const analysis = await analysed(source);
    expect(told(analysis, TEMPLATE)).toEqual([]);
    expect(issuesOf(analysis)).toEqual([
      `error METADATA_UNEXPECTED ${TEMPLATE} ${META} is the file of a EmailTemplate, and its root element is "EmailFolder".`,
    ]);
  });
});

describe('a report type', () => {
  const FILE = 'reportTypes/Invoices.reportType-meta.xml';
  const REPORT_TYPE = key('ReportType', 'Invoices');

  /** The project with a report type of these lines. */
  const withReportType = (lines: readonly string[], change: (source: Source) => void = () => undefined): Source => {
    const source = project();
    change(source);
    source.file(FILE, xml('ReportType', ...lines));
    return source;
  };
  /** A section with a column for each of these pairs of a table and a field. */
  const section = (...columns: (readonly [string, string])[]): string[] => [
    '<sections>',
    ...columns.flatMap(([table, field]) => [
      '    <columns>',
      `        <field>${field}</field>`,
      `        <table>${table}</table>`,
      '    </columns>',
    ]),
    '    <masterLabel>Fields</masterLabel>',
    '</sections>',
  ];

  it('names its object, the lookup field behind each child relationship it joins, and the fields it lists', async () => {
    const analysis = await analysed(
      withReportType([
        '<baseObject>Invoice__c</baseObject>',
        '<join>',
        '    <join>',
        '        <outerJoin>true</outerJoin>',
        '        <relationship>Payments__r</relationship>',
        '    </join>',
        '    <outerJoin>false</outerJoin>',
        '    <relationship>Lines__r</relationship>',
        '</join>',
        ...section(
          ['Invoice__c', 'Name'],
          ['Invoice__c', 'Amount__c'],
          ['Invoice__c', 'Account__c.Tier__c'],
          ['Invoice__c', 'Owner'],
          ['Invoice__c', 'Id'],
          ['Invoice__c.Lines__r', 'Quantity__c'],
          ['Invoice__c.Lines__r.Payments__r', 'Amount__c'],
        ),
      ]),
    );
    expect(told(analysis, REPORT_TYPE)).toEqual([
      '3:17 references CustomObject:invoice__c [Invoice__c] resolved object',
      '10:23 references CustomField:invoice_line__c.invoice__c [Lines__r] resolved join',
      '7:27 references CustomField:payment__c.line__c [Payments__r] resolved join',
      '14:20 references CustomField:invoice__c.name [Name] external listed-field',
      '18:20 references CustomField:invoice__c.amount__c [Amount__c] resolved listed-field',
      // A path through a lookup field, which a report type names by the field.
      '22:20 reads CustomField:invoice__c.account__c [Account__c] resolved listed-field',
      '22:31 references CustomField:account.tier__c [Tier__c] resolved listed-field',
      // A lookup field of Salesforce, named by its relationship. The id of the record is no field to refer to.
      '26:20 references CustomField:invoice__c.ownerid [Owner] external listed-field',
      '34:20 references CustomField:invoice_line__c.quantity__c [Quantity__c] resolved listed-field',
      '38:20 references CustomField:payment__c.amount__c [Amount__c] resolved listed-field',
    ]);
    expect(issuesOf(analysis)).toEqual([]);
  });

  it('joins the child relationships every org has, a hierarchy, and one of a package', async () => {
    const ofAccount = await analysed(
      withReportType([
        '<baseObject>Account</baseObject>',
        '<join>',
        '    <join>',
        '        <relationship>Cases</relationship>',
        '    </join>',
        '    <relationship>Contacts</relationship>',
        '</join>',
        ...section(['Account.Contacts', 'Email'], ['Account.Contacts.Cases', 'Subject']),
      ]),
    );
    expect(told(ofAccount, REPORT_TYPE)).toEqual([
      '3:17 references CustomObject:account [Account] external object',
      '8:23 references CustomField:contact.accountid [Contacts] external join',
      '6:27 references CustomField:case.contactid [Cases] external join',
      '12:20 references CustomField:contact.email [Email] external listed-field',
      '16:20 references CustomField:case.subject [Subject] external listed-field',
    ]);
    expect(issuesOf(ofAccount)).toEqual([]);

    const ofUser = await analysed(
      withReportType([
        '<baseObject>User</baseObject>',
        '<join>',
        '    <relationship>Backups__r</relationship>',
        '</join>',
        ...section(['User.Backups__r', 'Department']),
      ]),
    );
    expect(told(ofUser, REPORT_TYPE)).toEqual([
      '3:17 references CustomObject:user [User] external object',
      '5:23 references CustomField:user.backup__c [Backups__r] resolved join',
      '9:20 references CustomField:user.department [Department] external listed-field',
    ]);

    // A field of a package names its relationship without the prefix, which the relationship has.
    const ofPackage = await analysed(
      withReportType(
        [
          '<baseObject>Invoice__c</baseObject>',
          '<join>',
          '    <relationship>ns__Shipments__r</relationship>',
          '</join>',
          ...section(['Invoice__c.ns__Shipments__r', 'ns__Weight__c']),
        ],
        (source) => {
          source.object('ns__Shipment__c', '<label>Shipment</label>');
          source.field(
            'ns__Shipment__c',
            'ns__Invoice__c',
            '<type>Lookup</type>',
            '<referenceTo>Invoice__c</referenceTo>',
            '<relationshipName>Shipments</relationshipName>',
          );
        },
      ),
    );
    expect(told(ofPackage, REPORT_TYPE)).toEqual([
      '3:17 references CustomObject:invoice__c [Invoice__c] resolved object',
      '5:23 references CustomField:ns__shipment__c.ns__invoice__c [ns__Shipments__r] resolved join',
      '9:20 references CustomField:ns__shipment__c.ns__weight__c [ns__Weight__c] external listed-field',
    ]);
  });

  it('says where it does not know which object a child relationship leads to, and follows nothing behind it', async () => {
    const analysis = await analysed(
      withReportType(
        [
          '<baseObject>Invoice__c</baseObject>',
          '<join>',
          '    <join>',
          '        <relationship>Payments__r</relationship>',
          '    </join>',
          '    <relationship>Notes__r</relationship>',
          '</join>',
          ...section(['Invoice__c.Notes__r', 'Text__c'], ['Invoice__c.Notes__r.Payments__r', 'Amount__c']),
        ],
        // Two fields define the relationship of the lines: it is not known which one a report type joins.
        (source) => {
          source.field(
            'Payment__c',
            'Invoice__c',
            '<type>Lookup</type>',
            '<referenceTo>Invoice__c</referenceTo>',
            '<relationshipName>Lines</relationshipName>',
          );
        },
      ),
    );
    expect(told(analysis, REPORT_TYPE)).toEqual([
      '3:17 references CustomObject:invoice__c [Invoice__c] resolved object',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning PATH_NOT_FOLLOWED ${REPORT_TYPE} ${FILE}, line 8: it is not known which object the child relationship "Notes__r" of "Invoice__c" leads to, so it was not followed.`,
      `warning PATH_NOT_FOLLOWED ${REPORT_TYPE} ${FILE}, line 12: nothing says which object "Text__c" is a field of, so it was not followed.`,
      `warning PATH_NOT_FOLLOWED ${REPORT_TYPE} ${FILE}, line 16: nothing says which object "Amount__c" is a field of, so it was not followed.`,
    ]);
    // The lookup field behind the relationship can have any name: the warning says nothing of the end of a path,
    // and bears on every answer about what refers to a component (decision record 0077).
    expect(analysis.issues[0]?.details).toEqual({
      path: FILE,
      line: 8,
      column: 23,
      relationship: 'Notes__r',
      notFollowed: [],
      origin: 'parser:xml',
    });

    const twice = await analysed(
      withReportType(
        ['<baseObject>Invoice__c</baseObject>', '<join>', '    <relationship>Lines__r</relationship>', '</join>'],
        (source) => {
          source.field(
            'Payment__c',
            'Invoice__c',
            '<type>Lookup</type>',
            '<referenceTo>Invoice__c</referenceTo>',
            '<relationshipName>Lines</relationshipName>',
          );
        },
      ),
    );
    expect(told(twice, REPORT_TYPE)).toEqual(['3:17 references CustomObject:invoice__c [Invoice__c] resolved object']);
    expect(issuesOf(twice)).toEqual([
      `warning PATH_NOT_FOLLOWED ${REPORT_TYPE} ${FILE}, line 5: it is not known which object the child relationship "Lines__r" of "Invoice__c" leads to, so it was not followed.`,
    ]);
  });

  it('does not read a table that does not start at its object, nor a column that is no name', async () => {
    const analysis = await analysed(
      withReportType([
        '<baseObject>Invoice__c</baseObject>',
        ...section(['Account', 'Tier__c'], ['Invoice__c', 'Amount__c + 1'], ['Invoice__c', 'Status__c']),
      ]),
    );
    expect(told(analysis, REPORT_TYPE)).toEqual([
      '3:17 references CustomObject:invoice__c [Invoice__c] resolved object',
      '14:20 references CustomField:invoice__c.status__c [Status__c] resolved listed-field',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ ${REPORT_TYPE} ${FILE}, line 7: the element "table" holds "Account", and "Account" is not the object of the report type. It is not read.`,
      `warning NAME_NOT_READ ${REPORT_TYPE} ${FILE}, line 10: the element "field" holds "Amount__c + 1", which is not read as a name.`,
    ]);
  });
});

describe('a quick action', () => {
  const ACTIONS = 'quickActions/';

  /** The project with an action of this full name and these lines. */
  const withAction = (fullName: string, lines: readonly string[]): Source => {
    const source = project();
    source.file(`${ACTIONS}${fullName}.quickAction-meta.xml`, xml('QuickAction', ...lines));
    return source;
  };
  const override = (field: string, value: string): string[] => [
    '<fieldOverrides>',
    `    <field>${field}</field>`,
    `    ${value}`,
    '</fieldOverrides>',
  ];

  it('that updates its record writes fields of its own object, and reads what the formulas of the values name', async () => {
    const analysis = await analysed(
      withAction('Invoice__c.Mark_Paid', [
        ...override('Status__c', '<literalValue>Paid</literalValue>'),
        ...override('Amount__c', '<formula>Invoice__c.Amount__c * 2 + $User.Department</formula>'),
        ...override('Account__c', '<formula>Account.Id</formula>'),
        '<label>Mark Paid</label>',
        '<type>Update</type>',
      ]),
    );
    const action = key('QuickAction', 'Invoice__c.Mark_Paid');
    expect(told(analysis, action)).toEqual([
      '4:16 writes CustomField:invoice__c.status__c [Status__c] resolved assignment',
      '8:16 writes CustomField:invoice__c.amount__c [Amount__c] resolved assignment',
      '12:16 writes CustomField:invoice__c.account__c [Account__c] resolved assignment',
      '9:29 reads CustomField:invoice__c.amount__c [Amount__c] resolved formula',
      '9:51 reads CustomField:user.department [Department] external formula',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ ${action} ${ACTIONS}Invoice__c.Mark_Paid.quickAction-meta.xml, line 13: the formula in "formula" holds "Account.Id", and "Account" is not the object of the record the action runs on. It is not read.`,
    ]);
    // The formula is read by the reader of formulas.
    expect(analysis.work.find((one) => one.origin === 'parser:formula')).toMatchObject({
      components: 1,
      failedFiles: 0,
    });
  });

  it('that creates records names their object, and writes their fields and the lookup field to its own record', async () => {
    const analysis = await analysed(
      withAction('Invoice__c.New_Line', [
        ...override('Quantity__c', '<formula>1</formula>'),
        '<label>New Line</label>',
        '<targetObject>Invoice_Line__c</targetObject>',
        '<targetParentField>Invoice__c</targetParentField>',
        '<type>Create</type>',
      ]),
    );
    expect(told(analysis, key('QuickAction', 'Invoice__c.New_Line'))).toEqual([
      '8:19 references CustomObject:invoice_line__c [Invoice_Line__c] resolved object',
      '9:24 writes CustomField:invoice_line__c.invoice__c [Invoice__c] resolved assignment',
      '4:16 writes CustomField:invoice_line__c.quantity__c [Quantity__c] resolved assignment',
    ]);

    // A lookup field of Salesforce is named by its relationship.
    const ofAccount = await analysed(
      withAction('Account.New_Contact', [
        ...override('Department', '<literalValue>Billing</literalValue>'),
        '<label>New Contact</label>',
        '<targetObject>Contact</targetObject>',
        '<targetParentField>Account</targetParentField>',
        '<type>Create</type>',
      ]),
    );
    expect(told(ofAccount, key('QuickAction', 'Account.New_Contact'))).toEqual([
      '8:19 references CustomObject:contact [Contact] external object',
      '9:24 writes CustomField:contact.accountid [Account] external assignment',
      '4:16 writes CustomField:contact.department [Department] external assignment',
    ]);
    expect(issuesOf(ofAccount)).toEqual([]);
  });

  it('names the record type of the records it creates, and the email template it starts with', async () => {
    const source = withAction('Account.New_Invoice', [
      '<label>New Invoice</label>',
      '<targetObject>Invoice__c</targetObject>',
      '<targetParentField>Account__c</targetParentField>',
      '<targetRecordType>Invoice__c.Credit_Note</targetRecordType>',
      '<type>Create</type>',
    ]);
    source.file(
      'objects/Invoice__c/recordTypes/Credit_Note.recordType-meta.xml',
      xml('RecordType', '<fullName>Credit_Note</fullName>', '<active>true</active>', '<label>Credit Note</label>'),
    );
    expect(told(await analysed(source), key('QuickAction', 'Account.New_Invoice'))).toEqual([
      '4:19 references CustomObject:invoice__c [Invoice__c] resolved object',
      '6:34 references RecordType:invoice__c.credit_note [Credit_Note] resolved assignment',
      '5:24 writes CustomField:invoice__c.account__c [Account__c] resolved assignment',
    ]);

    // A record type is named by its object and its name. Any other name is not read.
    const alone = await analysed(
      withAction('Account.New_Invoice', [
        '<label>New Invoice</label>',
        '<targetObject>Invoice__c</targetObject>',
        '<targetRecordType>Credit_Note</targetRecordType>',
        '<type>Create</type>',
      ]),
    );
    expect(issuesOf(alone)).toEqual([
      `warning NAME_NOT_READ ${key('QuickAction', 'Account.New_Invoice')} ${ACTIONS}Account.New_Invoice.quickAction-meta.xml, line 5: the element "targetRecordType" holds "Credit_Note", which is not read as a name.`,
    ]);

    // An action that sends email names its template by its folder and its name. A task names the record it is
    // about by the relationship What.
    const email = withAction('Invoice__c.Send', [
      '<label>Send</label>',
      '<quickActionSendEmailOptions>',
      '    <defaultEmailTemplateName>Billing/Overdue</defaultEmailTemplateName>',
      '    <ignoreDefaultEmailTemplateSubject>false</ignoreDefaultEmailTemplateSubject>',
      '</quickActionSendEmailOptions>',
      '<targetObject>OutgoingEmail</targetObject>',
      '<type>SendEmail</type>',
    ]);
    email.file('email/Billing.emailFolder-meta.xml', xml('EmailFolder', '<name>Billing</name>'));
    email.file(
      'email/Billing/Overdue.email-meta.xml',
      xml('EmailTemplate', '<name>Overdue</name>', '<type>text</type>'),
    );
    email.file('email/Billing/Overdue.email', 'Overdue');
    email.file(
      `${ACTIONS}Account.Log.quickAction-meta.xml`,
      xml(
        'QuickAction',
        '<label>Log</label>',
        '<targetObject>Task</targetObject>',
        '<targetParentField>What</targetParentField>',
        '<type>LogACall</type>',
      ),
    );
    const sent = await analysed(email);
    expect(told(sent, key('QuickAction', 'Invoice__c.Send'))).toEqual([
      '8:19 references CustomObject:outgoingemail [OutgoingEmail] external object',
      '5:43 references EmailTemplate:billing/overdue [Overdue] resolved template',
    ]);
    expect(told(sent, key('QuickAction', 'Account.Log'))).toEqual([
      '4:19 references CustomObject:task [Task] external object',
      '5:24 writes CustomField:task.whatid [What] external assignment',
    ]);
    expect(issuesOf(sent)).toEqual([]);
  });

  it('shows in its layout fields of the object whose records it sets, sets those the user types in, and an empty space names nothing', async () => {
    const lines = (target: string): string[] => [
      '<label>New Line</label>',
      '<quickActionLayout>',
      '    <layoutSectionStyle>TwoColumnsLeftToRight</layoutSectionStyle>',
      '    <quickActionLayoutColumns>',
      '        <quickActionLayoutItems>',
      '            <emptySpace>false</emptySpace>',
      '            <field>Quantity__c</field>',
      '            <uiBehavior>Required</uiBehavior>',
      '        </quickActionLayoutItems>',
      '        <quickActionLayoutItems>',
      '            <emptySpace>true</emptySpace>',
      '            <uiBehavior>Edit</uiBehavior>',
      '        </quickActionLayoutItems>',
      '        <quickActionLayoutItems>',
      '            <emptySpace>false</emptySpace>',
      '            <field>Invoice__c</field>',
      '            <uiBehavior>Readonly</uiBehavior>',
      '        </quickActionLayoutItems>',
      '    </quickActionLayoutColumns>',
      '    <quickActionLayoutColumns/>',
      '</quickActionLayout>',
      ...(target === '' ? [] : [`<targetObject>${target}</targetObject>`]),
      '<type>Create</type>',
    ];
    const analysis = await analysed(withAction('Invoice__c.New_Line', lines('Invoice_Line__c')));
    expect(told(analysis, key('QuickAction', 'Invoice__c.New_Line'))).toEqual([
      '24:19 references CustomObject:invoice_line__c [Invoice_Line__c] resolved object',
      // The user types in the quantity, and only sees the invoice.
      '9:24 reads CustomField:invoice_line__c.quantity__c [Quantity__c] resolved listed-field',
      '9:24 writes CustomField:invoice_line__c.quantity__c [Quantity__c] resolved listed-field',
      '18:24 reads CustomField:invoice_line__c.invoice__c [Invoice__c] resolved listed-field',
    ]);
    expect(issuesOf(analysis)).toEqual([]);
    // A global action without an object: nothing says whose field the layout shows.
    const global = await analysed(withAction('New_Line', lines('')));
    expect(told(global, key('QuickAction', 'New_Line'))).toEqual([]);
    expect(issuesOf(global)).toEqual([
      `warning PATH_NOT_FOLLOWED ${key('QuickAction', 'New_Line')} ${ACTIONS}New_Line.quickAction-meta.xml, line 9: nothing says which object "Quantity__c" is a field of, so it was not followed.`,
      `warning PATH_NOT_FOLLOWED ${key('QuickAction', 'New_Line')} ${ACTIONS}New_Line.quickAction-meta.xml, line 18: nothing says which object "Invoice__c" is a field of, so it was not followed.`,
    ]);
  });

  it('that is global runs on no record: a name in a formula is not read, and a field of no object is not followed', async () => {
    const withTarget = await analysed(
      withAction('New_Invoice', [
        ...override('Status__c', '<literalValue>Draft</literalValue>'),
        ...override('Amount__c', '<formula>Invoice__c.Amount__c</formula>'),
        '<label>New Invoice</label>',
        '<targetObject>Invoice__c</targetObject>',
        '<type>Create</type>',
      ]),
    );
    const global = key('QuickAction', 'New_Invoice');
    expect(told(withTarget, global)).toEqual([
      '12:19 references CustomObject:invoice__c [Invoice__c] resolved object',
      '4:16 writes CustomField:invoice__c.status__c [Status__c] resolved assignment',
      '8:16 writes CustomField:invoice__c.amount__c [Amount__c] resolved assignment',
    ]);
    expect(issuesOf(withTarget)).toEqual([
      `warning NAME_NOT_READ ${global} ${ACTIONS}New_Invoice.quickAction-meta.xml, line 9: the formula in "formula" holds "Invoice__c.Amount__c", and "Invoice__c" is not the object of the record the action runs on. It is not read.`,
    ]);

    const without = await analysed(
      withAction('Log_Note', [
        ...override('Subject', '<literalValue>Note</literalValue>'),
        '<label>Log a Note</label>',
        '<type>LogACall</type>',
      ]),
    );
    expect(told(without, key('QuickAction', 'Log_Note'))).toEqual([]);
    expect(issuesOf(without)).toEqual([
      `warning PATH_NOT_FOLLOWED ${key('QuickAction', 'Log_Note')} ${ACTIONS}Log_Note.quickAction-meta.xml, line 4: nothing says which object "Subject" is a field of, so it was not followed.`,
    ]);
  });

  it('calls the flow it starts, and names the component, page or canvas app it opens', async () => {
    /** The references of an action that opens what `element` names, with the files of that in the project. */
    const opened = async (
      fullName: string,
      element: string,
      name: string,
      type: string,
      ...files: (readonly [string, string])[]
    ): Promise<string[]> => {
      const source = withAction(fullName, [
        '<label>Open</label>',
        `<${element}>${name}</${element}>`,
        `<type>${type}</type>`,
      ]);
      for (const [path, content] of files) source.file(path, content);
      return told(await analysed(source), key('QuickAction', fullName));
    };
    const flow = xml(
      'Flow',
      '<label>Recalculate</label>',
      '<processType>AutoLaunchedFlow</processType>',
      '<status>Active</status>',
    );
    expect(
      await opened('Invoice__c.Recalculate', 'flowDefinition', 'Invoice_Recalculate', 'Flow', [
        'flows/Invoice_Recalculate.flow-meta.xml',
        flow,
      ]),
    ).toEqual(['4:21 calls Flow:invoice_recalculate [Invoice_Recalculate] resolved action']);
    expect(
      await opened(
        'Invoice__c.Pay',
        'lightningWebComponent',
        'payInvoice',
        'LightningWebComponent',
        ['lwc/payInvoice/payInvoice.js', 'export default class {}\n'],
        ['lwc/payInvoice/payInvoice.js-meta.xml', xml('LightningComponentBundle', '<isExposed>true</isExposed>')],
      ),
    ).toEqual(['4:28 references LightningComponentBundle:payinvoice [payInvoice] resolved action']);
    expect(
      await opened(
        'Invoice__c.Refund',
        'lightningComponent',
        'refundInvoice',
        'LightningComponent',
        ['aura/refundInvoice/refundInvoice.cmp', '<aura:component/>\n'],
        ['aura/refundInvoice/refundInvoice.cmp-meta.xml', xml('AuraDefinitionBundle', '<apiVersion>66.0</apiVersion>')],
      ),
    ).toEqual(['4:25 references AuraDefinitionBundle:refundinvoice [refundInvoice] resolved action']);
    expect(
      await opened(
        'Invoice__c.Print',
        'page',
        'InvoicePrint',
        'VisualforcePage',
        ['pages/InvoicePrint.page', '<apex:page/>\n'],
        ['pages/InvoicePrint.page-meta.xml', xml('ApexPage', '<label>Print</label>')],
      ),
    ).toEqual(['4:11 references ApexPage:invoiceprint [InvoicePrint] resolved action']);
    expect(
      await opened('Invoice__c.Ledger', 'canvas', 'Ledger_App', 'Canvas', [
        'connectedApps/Ledger_App.connectedApp-meta.xml',
        xml('ConnectedApp', '<contactEmail>billing@example.com</contactEmail>', '<label>Ledger</label>'),
      ]),
    ).toEqual(['4:13 references ConnectedApp:ledger_app [Ledger_App] resolved action']);
    // Where the project does not hold it, the name is not found.
    expect(await opened('Invoice__c.Print', 'page', 'InvoicePrint', 'VisualforcePage')).toEqual([
      '4:11 references null [InvoicePrint] unresolved action',
    ]);
  });
});
