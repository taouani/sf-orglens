/**
 * Queries that are built in steps, from parameters, from other methods and from metadata.
 */
public with sharing class InvoiceQueries {
    public static List<Invoice__c> dueBefore(Date day, Boolean onlyOpen) {
        String soql = 'SELECT Id, Due_Date__c';
        soql += ', Late_Fee__c';
        soql += ' FROM Invoice__c WHERE Due_Date__c < :day';
        if (onlyOpen) {
            soql += ' AND Status__c != \'Paid\'';
        }
        return Database.query(soql);
    }

    public static List<Invoice__c> matching(String region, String tier) {
        List<String> clauses = new List<String>{ 'Region__c = :region' };
        if (tier != null) {
            clauses.add('Account__r.Tier__c = :tier');
        }
        String soql = 'SELECT Id FROM Invoice__c WHERE ' + String.join(clauses, ' AND ');
        return Database.query(soql);
    }

    public static List<Invoice__c> withFields(List<String> fieldNames) {
        return Database.query('SELECT ' + String.join(fieldNames, ', ') + ' FROM Invoice__c');
    }

    public static List<Invoice__c> paidInvoices() {
        return Database.query(paidQuery());
    }

    private static String paidQuery() {
        return 'SELECT Id, Paid_Date__c FROM Invoice__c WHERE Status__c = \'Paid\'';
    }

    public static Integer countAbove(Decimal minimum) {
        return Database.countQueryWithBinds(
            'SELECT COUNT() FROM Invoice__c WHERE Grand_Total__c > :minimum',
            new Map<String, Object>{ 'minimum' => minimum },
            AccessLevel.USER_MODE
        );
    }

    public static List<List<SObject>> taxCodes(String term) {
        return Search.query('FIND \'' + String.escapeSingleQuotes(term) + '\' RETURNING Tax_Code__c(Id, Rate__c)');
    }

    public static List<Invoice__c> lateFees() {
        Billing_Rule__mdt rule = Billing_Rule__mdt.getInstance('Invoice_Late_Fee');
        return Database.query('SELECT Id, ' + rule.Field_Name__c + ' FROM Invoice__c');
    }

    public static List<Invoice__c> summaries() {
        List<String> names = new List<String>();
        Schema.FieldSet summary = Schema.SObjectType.Invoice__c.fieldSets.getMap().get('Invoice_Summary');
        for (Schema.FieldSetMember member : summary.getFields()) {
            names.add(member.getFieldPath());
        }
        return Database.query('SELECT ' + String.join(names, ', ') + ' FROM Invoice__c');
    }
}
