/**
 * Builds queries as text. The field names come from literals, from constants and from the caller.
 */
public inherited sharing class InvoiceSelector {
    public static List<Invoice__c> byStatus(String status) {
        String soql = 'SELECT Id, Amount__c, Paid_Date__c FROM Invoice__c WHERE Status__c = :status';
        return Database.query(soql);
    }

    public static List<Invoice__c> withLegacyCode() {
        String soql = 'SELECT Id, ' + InvoiceConstants.FIELD_LEGACY
            + ' FROM ' + InvoiceConstants.OBJECT_INVOICE
            + ' WHERE ' + InvoiceConstants.FIELD_LEGACY + ' != null';
        return Database.query(soql);
    }

    public static List<Invoice__c> summaries() {
        String fields = String.join(InvoiceConstants.SUMMARY_FIELDS, ', ');
        return Database.query('SELECT ' + fields + ' FROM Invoice__c');
    }

    public static List<SObject> sortedBy(String fieldName) {
        String soql = 'SELECT Id FROM Invoice__c ORDER BY ' + fieldName;
        return Database.query(soql);
    }

    public static List<SObject> anyObject(String objectName, String fieldName) {
        return Database.query('SELECT ' + fieldName + ' FROM ' + objectName);
    }

    public static Database.QueryLocator overdue() {
        return Database.getQueryLocator(
            'SELECT Id, Days_Overdue__c FROM Invoice__c ' +
            'WHERE Due_Date__c < TODAY'
        );
    }

    public static List<Invoice__c> aboveAmount(Decimal minimum) {
        Map<String, Object> binds = new Map<String, Object>{ 'minimum' => minimum };
        return Database.queryWithBinds(
            'SELECT Id, Grand_Total__c FROM Invoice__c WHERE Amount__c >= :minimum',
            binds,
            AccessLevel.USER_MODE
        );
    }
}
